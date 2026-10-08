import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { detectMediaType } from '../shared/mediaTypes.mjs';
import { primaryDropFile } from '../shared/mediaDrop.mjs';
import { imageExtensions, isImage, cropImage, flipImage, rotateImage, rotateImageByAngle, resizeImage, adjustImage, removeColors, trimImage, alphaMask, packAtlas } from '../shared/image.mjs';
import { autoCutout } from '../shared/imageSubject.mjs';
import { ImageFileService, resolveBrowserPath } from '../electron/ImageFileService.mjs';

const pixels = (width, height, values) => ({ width, height, data: new Uint8ClampedArray(values) });
const png = await readFile(new URL('../public/icon.png', import.meta.url));

test('image types include all requested extensions irrespective of case', () => {
  assert.deepEqual(imageExtensions, ['jpg', 'jpeg', 'tif', 'tiff', 'png', 'gif', 'webp', 'bmp']);
  for (const ext of imageExtensions) {
    assert.equal(detectMediaType('Picture.' + ext.toUpperCase())?.id, 'image');
    assert.equal(isImage('Picture.' + ext.toUpperCase()), true);
  }
  assert.equal(detectMediaType('photo.PSD'), null);
});

test('drop routing preserves model textures and prefers a model over attached images', () => {
  const image = { name: 'albedo.PNG' }, model = { name: 'asset.GLB' };
  assert.equal(primaryDropFile([image], 'model3d'), null);
  assert.equal(primaryDropFile([image], 'home'), image);
  assert.equal(primaryDropFile([image, model], 'model3d'), model);
  assert.equal(primaryDropFile([image, model], 'home'), model);
});

test('crop, mirror and quarter rotation preserve exact pixels', () => {
  const source = pixels(2, 2, [1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]);
  const red = image => [...image.data].filter((_, index) => index % 4 === 0);
  assert.deepEqual(red(cropImage(source, { x: 1, y: 0, width: 1, height: 2 })), [2, 4]);
  assert.deepEqual(red(flipImage(source, 'horizontal')), [2, 1, 4, 3]);
  assert.deepEqual(red(flipImage(source, 'vertical')), [3, 4, 1, 2]);
  assert.deepEqual(red(rotateImage(source, 'cw')), [3, 1, 4, 2]);
  assert.deepEqual(red(rotateImage(source, 'ccw')), [2, 4, 1, 3]);
  assert.throws(() => cropImage(source, { x: 1, y: 0, width: 2, height: 1 }));
});

test('angle rotation keeps right angles exact and expands the transparent canvas', () => {
  const source = pixels(2, 2, [1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]);
  const unchanged = rotateImageByAngle(source, 0);
  assert.notEqual(unchanged.data, source.data);
  assert.deepEqual([...unchanged.data], [...source.data]);
  assert.deepEqual([...rotateImageByAngle(source, 90).data], [...rotateImage(source, 'cw').data]);
  assert.deepEqual([...rotateImageByAngle(source, -90).data], [...rotateImage(source, 'ccw').data]);
  assert.deepEqual([...rotateImageByAngle(source, 180).data.filter((_, index) => index % 4 === 0)], [4, 3, 2, 1]);

  const edge = pixels(2, 1, [255, 0, 0, 255, 0, 0, 255, 0]);
  const diagonal = rotateImageByAngle(edge, 45);
  assert.deepEqual([diagonal.width, diagonal.height], [3, 3]);
  const visible = [];
  for (let index = 0; index < diagonal.data.length; index += 4) if (diagonal.data[index + 3] > 0) visible.push([...diagonal.data.slice(index, index + 4)]);
  assert.ok(visible.length > 0);
  assert.ok(visible.every(([red, , blue]) => red === 255 && blue === 0), 'transparent blue must not bleed into the red edge');
  assert.deepEqual([...edge.data], [255, 0, 0, 255, 0, 0, 255, 0]);
  for (const angle of [-181, 181, NaN, '90']) assert.throws(() => rotateImageByAngle(source, angle), /angle/i);
});

test('resize uses premultiplied color interpolation and adjustments preserve alpha', () => {
  const source = pixels(2, 1, [255, 0, 0, 255, 0, 0, 255, 0]);
  const resized = resizeImage(source, 3, 1);
  assert.equal(resized.data[4], 255);
  assert.equal(resized.data[6], 0);
  assert.equal(resized.data[7], 128);
  const adjusted = adjustImage(source, { brightness: 10, contrast: 20, saturation: -30, sharpness: 0 });
  assert.equal(adjusted.data[3], 255);
  assert.equal(adjusted.data[7], 0);
});

test('color removal, checker removal and alpha masks are deterministic', () => {
  const source = pixels(3, 1, [255, 255, 255, 255, 204, 204, 204, 255, 0, 0, 0, 128]);
  const removed = removeColors(source, [[255, 255, 255], [204, 204, 204]], 0, 0);
  assert.deepEqual([removed.data[3], removed.data[7], removed.data[11]], [0, 0, 128]);
  const partial = alphaMask(removed, 'partial');
  assert.deepEqual([partial.data[3], partial.data[7], partial.data[11]], [0, 0, 255]);
  const trimmed = trimImage(removed);
  assert.equal(trimmed.width, 1); assert.equal(trimmed.offsetX, 2);
  assert.equal(trimImage(pixels(2, 1, [0, 0, 0, 0, 0, 0, 0, 0])).width, 1);
});

test('alpha mask separates empty, partial and opaque pixels and shows partial coverage', () => {
  const source = pixels(6, 1, [
    15, 200, 60, 0,
    15, 200, 60, 1,
    15, 200, 60, 64,
    15, 200, 60, 128,
    15, 200, 60, 254,
    15, 200, 60, 255
  ]);
  const original = source.data.slice();
  const full = alphaMask(source, 'full');
  const partial = alphaMask(source, 'partial');
  const both = alphaMask(source, 'both');
  const alphas = image => Array.from({ length: 6 }, (_, x) => image.data[x * 4 + 3]);
  assert.deepEqual(alphas(full), [224, 0, 0, 0, 0, 0]);
  assert.deepEqual(alphas(partial), [0, 255, 255, 255, 255, 0]);
  assert.deepEqual(alphas(both), [224, 255, 255, 255, 255, 0]);
  const brightness = [1, 2, 3, 4].map(x => partial.data[x * 4] + partial.data[x * 4 + 1] + partial.data[x * 4 + 2]);
  assert.ok(brightness.every((value, index) => index === 0 || brightness[index - 1] < value));
  assert.notDeepEqual(Array.from(both.data.subarray(0, 3)), Array.from(both.data.subarray(4, 7)));
  assert.deepEqual(source.data, original);
  assert.throws(() => alphaMask(source, 'off'), /Invalid alpha mask/);
});

test('auto cutout removes a baked checker, keeps separate subjects and preserves an enclosed highlight', () => {
  const width = 48, height = 48, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const background = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? 208 : 240;
    const opaque = (x >= 8 && x <= 19 && y >= 8 && y <= 19) || (x >= 28 && x <= 40 && y >= 28 && y <= 40);
    const edge = (x === 7 && y >= 8 && y <= 19) || (y === 27 && x >= 28 && x <= 40);
    const alpha = opaque ? 1 : edge ? .5 : 0;
    for (let c = 0; c < 3; c++) data[at + c] = Math.round(6 * alpha + background * (1 - alpha));
    data[at + 3] = 255;
  }
  for (let c = 0; c < 3; c++) data[(12 * width + 12) * 4 + c] = 240; // Interior light detail, not a hole.
  const result = autoCutout({ width, height, data });
  const alpha = (x, y) => result.data[(y * width + x) * 4 + 3];
  assert.equal(alpha(2, 2), 0);
  assert.equal(alpha(24, 24), 0);
  assert.equal(alpha(12, 13), 255);
  assert.equal(alpha(34, 34), 255);
  assert.equal(alpha(12, 12), 255);
  assert.ok(alpha(7, 12) >= 105 && alpha(7, 12) <= 150);
  assert.ok(alpha(34, 27) >= 105 && alpha(34, 27) <= 150);
});

test('auto cutout handles a plain backdrop and refuses ambiguous or empty subjects', () => {
  const width = 32, height = 32, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const alpha = x >= 9 && x <= 22 && y >= 9 && y <= 22 ? 1 : x === 8 && y >= 9 && y <= 22 ? .5 : 0;
    for (let c = 0; c < 3; c++) data[at + c] = Math.round([230, 50, 40][c] * alpha + [20, 100, 180][c] * (1 - alpha));
    data[at + 3] = 255;
  }
  const result = autoCutout({ width, height, data });
  assert.equal(result.data[(2 * width + 2) * 4 + 3], 0);
  assert.equal(result.data[(15 * width + 15) * 4 + 3], 255);
  assert.ok(result.data[(15 * width + 8) * 4 + 3] >= 110 && result.data[(15 * width + 8) * 4 + 3] <= 145);
  const empty = pixels(32, 32, Array.from({ length: 32 * 32 }, () => [20, 100, 180, 255]).flat());
  assert.throws(() => autoCutout(empty), /could not distinguish/);
  const noisy = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= 4 && x < width - 4 && y >= 4 && y < height - 4) continue;
    const at = (y * width + x) * 4;
    noisy[at] = (x * 37 + y * 67) % 256;
    noisy[at + 1] = (x * 89 + y * 11) % 256;
    noisy[at + 2] = (x * 17 + y * 103) % 256;
  }
  assert.throws(() => autoCutout({ width, height, data: noisy }), /could not identify/);
});

test('automatic and grid atlases fit and do not overlap', () => {
  const items = [{ id: 'a', width: 17, height: 9 }, { id: 'b', width: 10, height: 11 }, { id: 'c', width: 8, height: 8 }];
  for (const mode of ['auto', 'grid']) {
    const atlas = packAtlas(items, { mode, maxWidth: 48, maxHeight: 48, padding: 2 });
    assert.ok(atlas.width <= 48 && atlas.height <= 48);
    assert.equal(atlas.placements.length, items.length);
    for (const a of atlas.placements) {
      assert.ok(a.x + a.width <= atlas.width && a.y + a.height <= atlas.height);
      for (const b of atlas.placements) if (a !== b) assert.ok(a.x + a.width + 2 <= b.x || b.x + b.width + 2 <= a.x || a.y + a.height + 2 <= b.y || b.y + b.height + 2 <= a.y);
    }
  }
  assert.throws(() => packAtlas(items, { maxWidth: 17, maxHeight: 17 }));
});

test('automatic atlas sizing fits twenty full-resolution sprites and preserves manual limits', () => {
  const items = Array.from({ length: 20 }, (_, id) => ({ id, width: 640, height: 640 }));
  for (const mode of ['auto', 'grid']) {
    assert.throws(() => packAtlas(items, { mode, maxWidth: 2048, maxHeight: 2048 }));
    const atlas = packAtlas(items, { mode, autoSize: true });
    assert.equal(atlas.placements.length, 20);
    assert.ok(Math.max(atlas.width, atlas.height) <= 3210, 'Automatic size should avoid a long, narrow strip.');
    assert.ok(atlas.width * atlas.height <= 64_000_000);
    for (const a of atlas.placements) {
      assert.equal(a.width, 640); assert.equal(a.height, 640);
      assert.ok(a.x + a.width <= atlas.width && a.y + a.height <= atlas.height);
      for (const b of atlas.placements) if (a !== b) assert.ok(a.x + a.width + 2 <= b.x || b.x + b.width + 2 <= a.x || a.y + a.height + 2 <= b.y || b.y + b.height + 2 <= a.y);
    }
    assert.throws(() => packAtlas([{ width: 9000, height: 9000 }], { mode, autoSize: true }), /canvas|limits/);
  }
});

test('local image browser bounds paths and save never overwrites the source or an existing file', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-test-'));
  try {
    const source = path.join(folder, 'PHOTO.PNG');
    await writeFile(source, png);
    await mkdir(path.join(folder, 'nested'));
    assert.throws(() => resolveBrowserPath(folder, '..'));
    assert.throws(() => resolveBrowserPath(folder, path.parse(folder).root));
    const grants = new Map();
    let destination = source;
    const service = new ImageFileService({ window: {}, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) }, grants, ffmpeg: '' });
    const descriptor = await service.open(source);
    assert.equal(descriptor.browser.entries[0].name, 'nested');
    assert.equal(descriptor.browser.entries[1].name, 'PHOTO.PNG');
    assert.ok((await service.read(descriptor.sessionId, descriptor.relative)).startsWith('data:image/png;base64,'));
    const data = 'data:image/png;base64,' + png.toString('base64');
    await assert.rejects(service.save(descriptor.documentId, { format: 'png', data }), /preserve the source/);
    destination = path.join(folder, 'new.png');
    const saved = await service.save(descriptor.documentId, { format: 'png', data });
    assert.equal(saved.name, 'new.png');
    assert.equal(saved.relative, 'new.png');
    assert.equal(service.documents.get(descriptor.documentId).file, destination);
    assert.deepEqual(await readFile(source), png);
    assert.deepEqual(await readFile(destination), png);
    await assert.rejects(service.save(descriptor.documentId, { format: 'png', data }), /preserve the source/);
    destination = path.join(folder, 'atlas.png');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    const atlas = await service.saveAtlas(descriptor.sessionId, { format: 'png', data, width, height, frames: [{ relative: descriptor.relative, x: 0, y: 0, width, height }] });
    assert.equal(atlas.metadata, 'atlas.json');
    assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'atlas.json'), 'utf8')), { image: 'atlas.png', width, height, frames: [{ name: 'PHOTO.PNG', x: 0, y: 0, width, height }] });
    assert.deepEqual(await readFile(source), png);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('bundled codec converts static formats and decodes uppercase TIFF', async t => {
  if (!ffmpeg) return t.skip('FFmpeg binary is unavailable.');
  const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg });
  const data = 'data:image/png;base64,' + png.toString('base64');
  const signatures = { jpg: bytes => bytes[0] === 0xff && bytes[1] === 0xd8, webp: bytes => bytes.toString('ascii', 0, 4) === 'RIFF', bmp: bytes => bytes.toString('ascii', 0, 2) === 'BM', tiff: bytes => ['II', 'MM'].includes(bytes.toString('ascii', 0, 2)), gif: bytes => bytes.toString('ascii', 0, 3) === 'GIF' };
  const encoded = {};
  for (const format of Object.keys(signatures)) {
    encoded[format] = await service.encoded(data, format);
    assert.ok(signatures[format](encoded[format]), format + ' signature');
  }
  const gifPixels = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input: encoded.gif, maxBuffer: 30_000_000 });
  assert.equal(gifPixels.status, 0);
  assert.ok(Uint8Array.from({ length: Math.floor(gifPixels.stdout.length / 4) }, (_, index) => gifPixels.stdout[index * 4 + 3]).includes(0), 'static GIF retains binary transparency');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-codec-'));
  try {
    await writeFile(path.join(folder, 'UPPER.TIFF'), encoded.tiff);
    const descriptor = await service.open(path.join(folder, 'UPPER.TIFF'));
    const decoded = await service.read(descriptor.sessionId, descriptor.relative);
    const thumbnail = await service.decode(descriptor.sessionId, descriptor.relative, true);
    assert.ok(decoded.startsWith('data:image/png;base64,'));
    assert.ok(thumbnail.startsWith('data:image/png;base64,'));
    assert.ok(thumbnail.length < decoded.length);
  } finally { assert.ok(folder.startsWith(os.tmpdir() + path.sep)); await rm(folder, { recursive: true, force: true }); }
});

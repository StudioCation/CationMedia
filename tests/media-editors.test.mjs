import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clipRange, clipAudio, trimClip, splitClip, timelineScale } from '../shared/audioTimeline.mjs';
import { mixClips } from '../shared/audioMix.mjs';
import { videoOptions, videoGeometry, estimateVideoBytes, videoProfiles, videoEncodeArgs } from '../shared/video.mjs';
import { moveCrop } from '../shared/videoCrop.mjs';
import { mediaMenuTemplate } from '../shared/mediaMenu.mjs';
import { videoContextMenuTemplate } from '../shared/videoContextMenu.mjs';
import { audioFormats } from '../shared/mediaTypes.mjs';
import { VideoCodec } from '../electron/VideoCodec.mjs';
import { AudioCodec } from '../electron/AudioCodec.mjs';
import { decodeWave } from '../shared/audio.mjs';
import { videoResponse } from '../electron/videoResponse.mjs';

test('timeline resamples mono, offsets clips, sums overlaps and normalizes only overloads', () => {
  const mix = mixClips([
    { channels: [new Float32Array([.25, .25])], sampleRate: 2, start: .5 },
    { channels: [new Float32Array([.5, .5, .5, .5]), new Float32Array([.1, .1, .1, .1])], sampleRate: 4, start: 0 }
  ], 4);
  assert.deepEqual([...mix.channels[0]], [.5, .5, .75, .75, .25, .25]);
  assert.equal(mix.channels.length, 2); assert.equal(mix.peak, 1);
  const hot = mixClips([0, 1].map(() => ({ channels: [new Float32Array([.75, -.75])], sampleRate: 2, start: 0 })), 2);
  assert.equal(hot.peak, 1.5); assert.deepEqual([...hot.channels[0]], [1, -1]);
  assert.throws(() => mixClips([{ channels: [new Float32Array(2)], sampleRate: 2, start: 1e10 }]), /limit/);
});

const info = { width: 320, height: 240, duration: .4, fps: 25 };
const settings = { format: 'mp4', codec: 'libx264', width: 160, height: 90, fps: 25, bitrate: 500, mode: 'fit', crop: { left: 0, right: 0, top: 0, bottom: 0 }, audio: true };
test('video context menu exposes every video/audio conversion and frame saving', () => {
  const command = (label, action) => ({ label, action });
  const template = videoContextMenuTemplate({ hasAudio: true }, command);
  const convert = template.find(item => item.label === 'Convert To…');
  assert.deepEqual(convert.submenu[0].submenu.map(item => item.action), Object.keys(videoProfiles).map(format => `export:${format}`));
  assert.deepEqual(convert.submenu[1].submenu.map(item => item.action), audioFormats.map(format => `audio:${format}`));
  assert.ok(template.some(item => item.action === 'frame'));
  const silent = videoContextMenuTemplate({ hasAudio: false }, command);
  assert.equal(silent.find(item => item.label === 'Convert To…').submenu[1].enabled, false);
});

test('clip volume is passed to the mix used by playback and export', () => {
  const clip = { channels: [new Float32Array([.8, -.8])], sampleRate: 2, start: 0, gain: .25 };
  const output = mixClips([clipAudio(clip)], 2).channels[0];
  assert.ok(Math.abs(output[0] - .2) < 1e-6 && Math.abs(output[1] + .2) < 1e-6);
});

test('minimum timeline zoom fits long media inside the visible width', () => {
  const viewport = 900, duration = 6 * 60 * 60 + 5;
  const scale = timelineScale(10, duration, viewport);
  assert.ok(100 + duration * scale <= viewport);
  assert.ok(timelineScale(200, duration, viewport) > scale);
  assert.equal(timelineScale(50, 20, viewport), 50, 'ordinary clip zoom keeps its previous scale');
});
test('media menus exclude 3D actions from audio/video and retain them on home/3D', () => {
  const command = (label, action) => ({ label, action });
  for (const id of ['audio', 'video']) {
    const template = mediaMenuTemplate(id, command), text = JSON.stringify(template);
    assert.doesNotMatch(text, /Load 3D demo|Frame model|Blender|Shade|Wireframe/);
    assert.ok(template.some(item => item.label === 'Playback'));
  }
  for (const id of [null, 'model3d']) assert.match(JSON.stringify(mediaMenuTemplate(id, command)), /Load 3D demo/);
});
test('visual crop movement and resize preserve source bounds and minimum rectangle', () => {
  const crop = { left: 20, right: 30, top: 10, bottom: 40 };
  assert.deepEqual(moveCrop(crop, 'move', 1000, -1000, 320, 240), { left: 50, right: 0, top: 0, bottom: 50 });
  assert.deepEqual(moveCrop(crop, 'nw', -100, -100, 320, 240), { left: 0, right: 30, top: 0, bottom: 40 });
  const small = moveCrop(crop, 'se', -1000, -1000, 320, 240);
  assert.equal(320 - small.left - small.right, 2); assert.equal(240 - small.top - small.bottom, 2);
});
test('audio quality affects encoding and size estimates, with Opus rate validation', () => {
  const o = { ...settings, audioBitrate: 96, audioRate: 44100, audioChannels: 1 };
  const args = videoEncodeArgs(o, info);
  assert.equal(args[args.indexOf('-b:a') + 1], '96k'); assert.equal(args[args.indexOf('-ar') + 1], '44100'); assert.equal(args[args.indexOf('-ac') + 1], '1');
  assert.ok(estimateVideoBytes(o, 100) < estimateVideoBytes(settings, 100));
  assert.throws(() => videoOptions({ ...o, format: 'webm', codec: 'libvpx-vp9' }, info), /Opus/);
  const audio = new AudioCodec('unused');
  const encoding = audio.exportOptions({ format: 'mp3', quality: 'high', sampleRate: 0, bitrate: 96 });
  assert.equal(encoding[encoding.indexOf('-b:a') + 1], '96k');
  assert.throws(() => audio.exportOptions({ format: 'mp3', quality: 'high', sampleRate: 0, bitrate: 999 }), /bitrate/);
});
test('video validates crop, dimensions, container compatibility, and output estimate', () => {
  assert.throws(() => videoOptions({ ...settings, width: 161 }, info), /even/);
  assert.throws(() => videoOptions({ ...settings, crop: { left: 320 } }, info), /Crop/);
  assert.throws(() => videoOptions({ ...settings, format: 'webm' }, info), /combination/);
  const fit = videoGeometry(settings, info), fill = videoGeometry({ ...settings, mode: 'fill' }, info);
  assert.equal(fit.dw, 120); assert.equal(fit.dx, 20); assert.equal(fill.dw, 160); assert.equal(fill.dy, -15);
  assert.ok(estimateVideoBytes({ ...settings, bitrate: 1000 }, 10) > estimateVideoBytes(settings, 10));
});

test('real FFmpeg encodes every offered container/codec and extracts video audio', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cation-video-test-'));
  const codec = new VideoCodec(path.resolve('node_modules/ffmpeg-static/ffmpeg.exe'));
  try {
    const source = path.join(dir, 'source.mp4');
    await codec.run(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=0.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source]);
    const metadata = await codec.probe(source); assert.equal(metadata.width, 320); assert.equal(metadata.height, 240); assert.ok(metadata.hasAudio);
    const audioCodec = new AudioCodec(codec.executable);
    for (const format of audioFormats) {
      const target = path.join(dir, `extracted.${format}`);
      await codec.extractAudio(source, target, format, audioCodec.exportOptions({ format, quality: 'high', sampleRate: 48000 }));
      const extracted = decodeWave(await audioCodec.decode(target));
      assert.ok(extracted.channels[0].some(value => Math.abs(value) > .01), format);
      assert.equal(extracted.sampleRate, 48000);
    }
    const frame = path.join(dir, 'frame.png');
    await codec.frame(source, frame, metadata.duration, settings, metadata);
    const png = await readFile(frame);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 160); assert.equal(png.readUInt32BE(20), 90);
    await assert.rejects(codec.frame(source, frame, -1, settings, metadata), /frame time/);
    const partial = await videoResponse(source, new Request('http://localhost/video', { headers: { range: 'bytes=10-29' } }));
    assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 20);
    const suffix = await videoResponse(source, new Request('http://localhost/video', { headers: { range: 'bytes=-16' } }));
    assert.equal((await suffix.arrayBuffer()).byteLength, 16);
    const invalid = await videoResponse(source, new Request('http://localhost/video', { headers: { range: 'bytes=999999999-' } }));
    assert.equal(invalid.status, 416);
    const decoded = decodeWave(await new AudioCodec(codec.executable).decode(source)); assert.ok(decoded.channels[0].some(n => Math.abs(n) > .01));
    for (const [format, profile] of Object.entries(videoProfiles)) for (const encoder of profile.codecs) {
      const target = path.join(dir, `${encoder}.${format}`);
      await codec.export(source, target, { ...settings, format, codec: encoder, mode: 'fill', crop: { left: 20, right: 20, top: 10, bottom: 10 } }, metadata);
      assert.ok((await stat(target)).size > 0, `${format}/${encoder}`);
      const result = await codec.probe(target); assert.equal(result.width, 160); assert.equal(result.height, 90); assert.equal(result.fps, 25);
    }
    const proxy = await codec.preview(source, metadata); assert.ok((await stat(proxy)).size > 0);
    const monoVideo = path.join(dir, 'mono.mp4');
    await codec.export(source, monoVideo, { ...settings, audioBitrate: 96, audioRate: 44100, audioChannels: 1 }, metadata);
    const mono = decodeWave(await new AudioCodec(codec.executable).decode(monoVideo));
    assert.equal(mono.sampleRate, 44100); assert.equal(mono.channels.length, 1);
  } finally { await codec.dispose(); await rm(dir, { recursive: true, force: true }); }
});


test('timeline trim is reversible and splitting preserves every sample and global timing', () => {
  const source = Float32Array.from({ length: 100 }, (_, i) => i / 100);
  const clip = { channels: [source], sampleRate: 10, start: 2 };
  const trimmed = { ...clip, ...trimClip(clip, 'left', 3) };
  assert.equal(trimmed.start, 5); assert.equal(clipRange(trimmed).duration, 7);
  assert.equal(clipAudio(trimmed).channels[0][0], source[30]);
  const restored = { ...trimmed, ...trimClip(trimmed, 'left', -30) };
  assert.equal(restored.start, 2); assert.equal(clipRange(restored).from, 0);
  const halves = splitClip(trimmed, 8);
  assert.equal(halves[1].start, 8);
  const originalMix = mixClips([clipAudio(trimmed)], 10).channels[0];
  const splitMix = mixClips(halves.map(part => clipAudio({ ...trimmed, ...part })), 10).channels[0];
  assert.deepEqual(splitMix, originalMix);
  assert.equal(splitClip(trimmed, 5), null); assert.equal(splitClip(trimmed, 12), null);
  assert.equal(clipRange({ ...clip, ...trimClip(clip, 'right', -100) }).duration, .1);
  assert.equal(source.length, 100);
});

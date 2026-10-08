import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustImage, cropImage, flipImage, removeColors, resizeImage,
  rotateImage, rotateImageByAngle, trimImage
} from '../shared/image.mjs';
import { applyImageEffects } from '../shared/imageEffects.mjs';
import { autoCutout } from '../shared/imageSubject.mjs';

const pixels = (width, height, values) => ({ width, height, data: new Uint8ClampedArray(values) });
const channels = image => [...image.data];

test('replay returns an independent image and leaves the source untouched', () => {
  const source = pixels(2, 1, [10, 20, 30, 255, 40, 50, 60, 128]);
  const copy = channels(source);
  const result = applyImageEffects(source, []);
  assert.notEqual(result, source);
  assert.notEqual(result.data, source.data);
  assert.deepEqual(channels(result), copy);
  result.data[0] = 99;
  assert.deepEqual(channels(source), copy);
});

test('effects run in list order; disabling one replays from the unchanged source', () => {
  const source = pixels(2, 2, [
    10, 0, 0, 255, 20, 0, 0, 255,
    30, 0, 0, 255, 40, 0, 0, 255
  ]);
  const effects = [
    { id: 'flip-h', enabled: true },
    { id: 'crop', enabled: true, params: { rect: { x: 0, y: 0, width: 1, height: 2 } } }
  ];
  assert.deepEqual(channels(applyImageEffects(source, effects)), channels(cropImage(flipImage(source, 'horizontal'), effects[1].params.rect)));
  assert.deepEqual(channels(applyImageEffects(source, [{ ...effects[0], enabled: false }, effects[1]])), [10, 0, 0, 255, 30, 0, 0, 255]);
  assert.deepEqual(channels(source), [10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]);
});

test('every geometric and color effect maps to the existing image operation', () => {
  const source = pixels(2, 2, [
    255, 255, 255, 255, 20, 100, 40, 128,
    0, 0, 0, 0, 80, 40, 20, 255
  ]);
  const cases = [
    [{ id: 'brightness', params: { value: 12 } }, adjustImage(source, { brightness: 12 })],
    [{ id: 'contrast', params: { value: -20 } }, adjustImage(source, { contrast: -20 })],
    [{ id: 'saturation', params: { value: 15 } }, adjustImage(source, { saturation: 15 })],
    [{ id: 'sharpness', params: { value: 18 } }, adjustImage(source, { sharpness: 18 })],
    [{ id: 'flip-h' }, flipImage(source, 'horizontal')],
    [{ id: 'flip-v' }, flipImage(source, 'vertical')],
    [{ id: 'rotate-left' }, rotateImage(source, 'ccw')],
    [{ id: 'rotate-right' }, rotateImage(source, 'cw')],
    [{ id: 'rotate', params: { angle: -45 } }, rotateImageByAngle(source, -45)],
    [{ id: 'resize', params: { width: 3, height: 3 } }, resizeImage(source, 3, 3)],
    [{ id: 'trim' }, trimImage(source)],
    [{ id: 'remove-color', params: { color: [255, 255, 255], tolerance: 0, softness: 0 } }, removeColors(source, [[255, 255, 255]], 0, 0)]
  ];
  for (const [effect, expected] of cases) {
    const result = applyImageEffects(source, [effect]);
    assert.equal(result.width, expected.width, effect.id + ' width');
    assert.equal(result.height, expected.height, effect.id + ' height');
    assert.deepEqual(channels(result), channels(expected), effect.id + ' pixels');
  }
  assert.deepEqual(channels(applyImageEffects(source, [{ id: 'remove-color', params: { colors: [[255, 255, 255]], tolerance: 0, softness: 0 } }])), channels(cases.at(-1)[1]));
});

test('auto cutout and checker removal share background detection and can be disabled', () => {
  const width = 32, height = 32, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const value = x >= 9 && x <= 22 && y >= 9 && y <= 22 ? 5 : 240;
    data.set([value, value, value, 255], at);
  }
  const source = { width, height, data }, original = channels(source);
  const expected = autoCutout(source);
  for (const id of ['auto-cutout', 'remove-grid']) {
    assert.deepEqual(channels(applyImageEffects(source, [{ id }])), channels(expected), id);
    assert.deepEqual(channels(applyImageEffects(source, [{ id, enabled: false }])), original, id + ' disabled');
  }
  assert.deepEqual(channels(source), original);
});

test('invalid effects give actionable errors without mutating the input', () => {
  const source = pixels(1, 1, [8, 16, 24, 255]), before = channels(source);
  assert.throws(() => applyImageEffects(source, null), /effects must be an array/i);
  assert.throws(() => applyImageEffects(source, [null]), /effect at index 0/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'unknown', enabled: false }]), /unknown image effect "unknown"/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'flip-h', enabled: 'false' }]), /enabled must be a boolean/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'flip-h', params: null }]), /params must be an object/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'crop' }]), /crop.*rect is required/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'resize', params: { width: 0, height: 1 } }]), /resize.*supported canvas size/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'brightness', params: { value: 101 } }]), /brightness.*invalid adjustment/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'rotate', params: { angle: 181 } }]), /rotate.*angle/i);
  assert.throws(() => applyImageEffects(source, [{ id: 'remove-color', params: { color: [100, 100] } }]), /remove-color.*valid background color/i);
  assert.deepEqual(channels(applyImageEffects(source, [{ id: 'crop', enabled: false, params: 'ignored' }])), before);
  assert.deepEqual(channels(source), before);
});

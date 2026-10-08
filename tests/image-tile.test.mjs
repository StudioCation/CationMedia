import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSeamlessTile } from '../shared/imageTile.mjs';
import { applyImageEffects } from '../shared/imageEffects.mjs';

const at = (image, x, y, channel) => image.data[(y * image.width + x) * 4 + channel];

test('loop texture removes centre seams and repeats smoothly on both axes', () => {
  const size = 128, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    data.set([Math.round(x * 255 / (size - 1)), Math.round(y * 255 / (size - 1)), 80, 255], index);
  }
  const source = { width: size, height: size, data };
  const result = makeSeamlessTile(source, { size, blend: 30 });
  for (let coordinate = 0; coordinate < size; coordinate++) {
    assert.ok(Math.abs(at(result, size - 1, coordinate, 0) - at(result, 0, coordinate, 0)) <= 3, 'left/right border');
    assert.ok(Math.abs(at(result, size / 2 - 1, coordinate, 0) - at(result, size / 2, coordinate, 0)) <= 3, 'vertical centre seam');
    assert.ok(Math.abs(at(result, coordinate, size - 1, 1) - at(result, coordinate, 0, 1)) <= 3, 'top/bottom border');
    assert.ok(Math.abs(at(result, coordinate, size / 2 - 1, 1) - at(result, coordinate, size / 2, 1)) <= 3, 'horizontal centre seam');
  }
  assert.equal(at(source, 0, 0, 0), 0);
  assert.equal(at(source, size - 1, size - 1, 0), 255);
});

test('loop texture closes the outer borders even when the source centre has a sharp edge', () => {
  const size = 128, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    data.set([x < 64 ? 20 : 235, y < 64 ? 15 : 240, 90, 255], (y * size + x) * 4);
  }
  const result = makeSeamlessTile({ width: size, height: size, data }, { size, blend: 30 });
  for (let coordinate = 0; coordinate < size; coordinate++) {
    for (let channel = 0; channel < 4; channel++) {
      assert.equal(at(result, 0, coordinate, channel), at(result, size - 1, coordinate, channel), 'left/right border');
      assert.equal(at(result, coordinate, 0, channel), at(result, coordinate, size - 1, channel), 'top/bottom border');
    }
  }
  assert.notEqual(at(result, 20, 20, 0), at(result, 108, 20, 0), 'interior texture remains');
});

test('loop texture preserves detail next to both borders instead of spreading edge pixels into strips', () => {
  const size = 128, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    data.set([x === size / 2 ? 240 : 0, y === size / 2 ? 240 : 0, 50, 255], (y * size + x) * 4);
  }
  const source = { width: size, height: size, data };
  const result = makeSeamlessTile(source, { size, blend: 45 });
  assert.equal(at(result, 1, size / 2, 0), 0, 'the second column retains the shifted source detail');
  assert.equal(at(result, size - 2, size / 2, 0), 0, 'the penultimate column retains the shifted source detail');
  assert.equal(at(result, size / 2, 1, 1), 0, 'the second row retains the shifted source detail');
  assert.equal(at(result, size / 2, size - 2, 1), 0, 'the penultimate row retains the shifted source detail');
  assert.equal(at(result, size / 2, size / 2, 0), 240, 'the centre copy covers the internal seam');
  assert.equal(at(source, size / 2, size / 2, 0), 240, 'the original source is unchanged');
});

test('loop texture crops a non-square source from the centre, resizes, and remains editable', () => {
  const source = {
    width: 4, height: 2,
    data: new Uint8ClampedArray(Array.from({ length: 2 }, () => [
      255, 0, 0, 255, 0, 180, 0, 255, 0, 180, 0, 255, 255, 0, 0, 255
    ]).flat())
  };
  const effect = { id: 'loop-texture', params: { size: 256, blend: 20 } };
  const result = applyImageEffects(source, [effect]);
  assert.equal(result.width, 256);
  assert.equal(result.height, 256);
  assert.deepEqual([...result.data.slice(0, 4)], [0, 180, 0, 255]);
  assert.deepEqual([...result.data.slice(-4)], [0, 180, 0, 255]);
  assert.deepEqual([...applyImageEffects(source, [{ ...effect, enabled: false }]).data], [...source.data]);
  assert.deepEqual([...source.data.slice(0, 4)], [255, 0, 0, 255]);
});

test('loop texture uses premultiplied alpha while blending', () => {
  const data = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    data.set(x < 64 ? [220, 30, 10, 255] : [0, 0, 255, 0], (y * 128 + x) * 4);
  }
  const result = makeSeamlessTile({ width: 128, height: 128, data }, { size: 128, blend: 50 });
  for (let index = 0; index < result.data.length; index += 4) {
    if (result.data[index + 3]) {
      assert.equal(result.data[index], 220);
      assert.equal(result.data[index + 1], 30);
      assert.equal(result.data[index + 2], 10);
    }
  }
});

test('loop texture rejects unsupported export sizes and blend widths', () => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
  assert.throws(() => makeSeamlessTile(source, { size: 300 }), /power of two/i);
  assert.throws(() => makeSeamlessTile(source, { size: 8192 }), /power of two/i);
  assert.throws(() => makeSeamlessTile(source, { size: 128, blend: 0 }), /blend width/i);
});

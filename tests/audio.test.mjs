import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { encodeWave, decodeWave, audioFilter, fadeSelection } from '../shared/audio.mjs';
import { detectMediaType, hasCapability, audioFormats } from '../shared/mediaTypes.mjs';
import { AudioCodec } from '../electron/AudioCodec.mjs';
import { buildPeaks } from '../shared/audioPeaks.mjs';

test('waveform pyramid preserves extrema and tail samples at every zoom level', () => {
  const channels = [Float32Array.from({ length: 1031 }, (_, i) => Math.sin(i)), new Float32Array(1031)];
  channels[1][1030] = -.9; channels[1][127] = .8;
  const peaks = buildPeaks(channels);
  for (const [c, levels] of peaks.entries()) for (const { size, min, max } of levels) {
    for (let i = 0; i < min.length; i++) {
      const values = channels[c].slice(i * size, (i + 1) * size);
      assert.equal(min[i], Math.min(...values)); assert.equal(max[i], Math.max(...values));
    }
  }
});

const rate = 48000;
const signal = (hz = 440, duration = 1, gain = .3) => Float32Array.from({ length: rate * duration }, (_, i) => Math.sin(i * 2 * Math.PI * hz / rate) * gain);
const frequency = channel => { const a = Math.floor(channel.length * .2), b = Math.floor(channel.length * .8); let n = 0; for (let i = a + 1; i < b; i++) if (channel[i - 1] <= 0 && channel[i] > 0) n++; return n * rate / (b - a); };
const rms = channel => Math.sqrt(channel.reduce((sum, n) => sum + n * n, 0) / channel.length);
test('audio has separate capabilities; WAV float round-trip preserves independent channels', () => {
  assert.equal(detectMediaType('MUSIC.MP3').id, 'audio'); assert.equal(hasCapability('audio', 'camera'), false);
  const channels = [signal(), signal(660)], decoded = decodeWave(encodeWave(channels, rate));
  assert.equal(decoded.sampleRate, rate); assert.deepEqual(decoded.channels, channels);
  assert.throws(() => decodeWave(new Uint8Array(44)), /Invalid/);
  assert.throws(() => decodeWave(encodeWave(channels, rate).slice(0, -5)), /Truncated/);
  assert.throws(() => audioFilter('pitch', '1,volume=10', 1), /Invalid/);
  assert.throws(() => audioFilter('stretch', 0, 1), /range/);
});
test('selection fades cover the full range with exact endpoints on every channel', () => {
  const channels = [new Float32Array([1, 1, 1, 1, 1]), new Float32Array([-2, -2, -2, -2, -2])];
  assert.deepEqual([...fadeSelection(channels, 'in')[0]], [0, .25, .5, .75, 1]);
  assert.deepEqual([...fadeSelection(channels, 'out')[1]], [-2, -1.5, -1, -.5, -0]);
  assert.equal(channels[0][0], 1, 'Original samples remain available for undo');
});

test('bundled codec exports/reopens every format and preserves pitch, tempo, channels and gain contracts', { timeout: 120000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-codec-test-')), codec = new AudioCodec(path.resolve('node_modules/ffmpeg-static/ffmpeg.exe'));
  const source = encodeWave([signal(), signal(660)], rate);
  try {
    for (const format of audioFormats) {
      const file = path.join(folder, `roundtrip.${format}`);
      await writeFile(file, await codec.encode({ data: source, format, quality: 'high', sampleRate: 0 }));
      assert.ok((await stat(file)).size > 100);
      const result = decodeWave(await codec.decode(file));
      assert.equal(result.channels.length, 2, format); assert.ok(Math.abs(result.channels[0].length / result.sampleRate - 1) < .12, format);
    }
    const pitch = decodeWave(await codec.process({ data: source, effect: 'pitch', value: 12 }));
    assert.ok(Math.abs(pitch.channels[0].length / rate - 1) < .02); assert.ok(Math.abs(frequency(pitch.channels[0]) - 880) < 10);
    const stretch = decodeWave(await codec.process({ data: source, effect: 'stretch', value: 200 }));
    assert.ok(Math.abs(stretch.channels[0].length / rate - 2) < .04); assert.ok(Math.abs(frequency(stretch.channels[0]) - 440) < 10);
    const gain = decodeWave(await codec.process({ data: source, effect: 'gain', value: 50 }));
    assert.ok(Math.abs(rms(gain.channels[0]) / rms(signal()) - .5) < .002);
    for (const effect of ['chorus', 'distortion', 'smooth', 'fade-in', 'fade-out', 'reverse']) {
      const result = decodeWave(await codec.process({ data: source, effect, value: effect.startsWith('fade') ? .2 : 50 }));
      assert.equal(result.channels.length, 2); assert.ok(rms(result.channels[0]) > 0, effect);
      if (effect === 'fade-in') assert.ok(rms(result.channels[0].slice(0, 500)) < .02);
      if (effect === 'fade-out') assert.ok(rms(result.channels[0].slice(-500)) < .02);
    }
    await assert.rejects(codec.process({ data: source, effect: 'unknown', value: 1 }), /Unknown/);
    await assert.rejects(codec.encode({ data: source, format: 'exe', quality: 'high', sampleRate: 0 }), /Invalid/);
    const invalid = path.join(folder, 'broken.mp3'); await writeFile(invalid, 'not audio'); await assert.rejects(codec.decode(invalid));
  } finally { codec.dispose(); await rm(folder, { recursive: true, force: true }); }
});

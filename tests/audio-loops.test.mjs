import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMusicalLoops } from '../shared/audioLoopAnalysis.mjs';
import { musicFixture } from './music-fixture.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AudioCodec } from '../electron/AudioCodec.mjs';
import { encodeWave, decodeWave } from '../shared/audio.mjs';

for (const options of [{ bpm: 120, meter: 4 }, { bpm: 100, meter: 4 }, { bpm: 137, meter: 4 }, { bpm: 90, meter: 3 }, { bpm: 120, meter: 4, opposite: true }]) {
  test(`musical loops follow known ${options.bpm} BPM / ${options.meter}-beat bars${options.opposite ? ' with opposite stereo phase' : ''}`, () => {
    const fixture = musicFixture(options), report = analyzeMusicalLoops(fixture.channels, fixture.rate, 2, 62);
    assert.ok(report.loops.length > 0, JSON.stringify(report));
    assert.ok(Math.abs(report.bpm - options.bpm) < .5);
    for (const [i, loop] of report.loops.entries()) {
      const seconds = loop.end - loop.start, beats = seconds * options.bpm / 60;
      assert.ok(loop.start >= 2 && loop.end <= 62 && seconds <= 20);
      assert.equal(loop.beatsPerBar, options.meter);
      assert.ok(Math.abs(beats - loop.bars * options.meter) < .025);
      assert.ok(loop.boundaryError < .02 && loop.seamError < .08);
      if (i) assert.ok(loop.start >= report.loops[i - 1].end);
      // Starts are near a known downbeat, including a small pre-transient lead-in.
      const beatPhase = (loop.start - fixture.offset) / (60 / options.bpm * options.meter);
      assert.ok(Math.abs(beatPhase - Math.round(beatPhase)) < .025);
    }
    assert.equal(report.loops.length, 1, 'Repeated copies, rotations and double-length copies are not unique loops');
    if (fixture.phraseSeconds >= 8 && fixture.phraseSeconds <= 12) assert.ok(report.loops[0].end - report.loops[0].start >= 8 - .01 && report.loops[0].end - report.loops[0].start <= 12 + .01);
  });
}

test('silence, steady tones and non-repeating noise do not become musical loops', () => {
  const rate = 8000, frames = rate * 30;
  let seed = 817; const noise = Float32Array.from({ length: frames }, () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return seed / 2147483648 * .3; });
  for (const signal of [new Float32Array(frames), Float32Array.from({ length: frames }, (_, i) => .3 * Math.sin(i * 2 * Math.PI * 440 / rate)), noise]) {
    assert.deepEqual(analyzeMusicalLoops([signal], rate).loops, []);
  }
});

test('different arrangements sharing the same rhythm and harmony remain separate loops', () => {
  const fixture = musicFixture(), changeAt = 32 + fixture.offset;
  for (const channel of fixture.channels) {
    let low = 0;
    for (let i = 0; i < channel.length; i++) {
      low += .04 * (channel[i] - low);
      if (i >= Math.round(changeAt * fixture.rate)) channel[i] = .7 * channel[i] + .3 * low;
    }
  }
  const report = analyzeMusicalLoops(fixture.channels, fixture.rate);
  assert.equal(report.loops.length, 2, 'Copies within each arrangement collapse, but distinct timbres survive');
  assert.ok(report.loops[0].end < changeAt && report.loops[1].start > changeAt);
  for (const loop of report.loops) {
    assert.ok(Math.abs(loop.end - loop.start - 8) < .006);
    assert.ok(loop.levelError <= .03 && loop.seamError <= .08);
  }
});

test('countdown track retains its confirmed loop and finds additional non-overlapping sections', { skip: !process.env.AUDIO_TEST_FILE }, async () => {
  const codec = new AudioCodec(path.resolve('node_modules/ffmpeg-static/ffmpeg.exe'));
  try {
    const audio = decodeWave(await codec.decode(process.env.AUDIO_TEST_FILE));
    const started = performance.now(), report = analyzeMusicalLoops(audio.channels, audio.sampleRate);
    assert.ok(report.loops.length >= 6, JSON.stringify(report));
    assert.ok(report.loops.some(loop => Math.abs(loop.start - 14.5865) < .06 && Math.abs(loop.end - 21.4501) < .06), 'Recover the second intro phrase between the old analysis windows');
    assert.ok(report.loops.some(loop => Math.abs(loop.start - 7.72) < .06 && Math.abs(loop.end - 14.57) < .06 && loop.rhythmMethod === 'phrase'), 'Recover the syncopated phrase shown in the user screenshot');
    assert.ok(report.loops.some(loop => Math.abs(loop.start - 80.15224489795918) < 1 / audio.sampleRate && Math.abs(loop.end - 87.00560090702947) < 1 / audio.sampleRate));
    assert.ok(report.loops.some(loop => loop.end < 65) && report.loops.some(loop => loop.start > 160));
    for (const [i, loop] of report.loops.entries()) {
      assert.ok(loop.end - loop.start <= 20 && loop.levelError <= .03);
      assert.ok(loop.seamError <= (loop.boundaryMethod === 'musical' ? .06 : .08));
      assert.ok(Math.abs((loop.end - loop.start) - loop.bars * loop.beatsPerBar * 60 / loop.bpm) <= .03);
      if (i) assert.ok(loop.start >= report.loops[i - 1].end);
    }
    console.log('Countdown analysis:', Math.round(performance.now() - started), 'ms;', report.loops.length, 'loops');
  } finally { codec.dispose(); }
});

test('an incompatible second channel rejects an otherwise repeating left channel', () => {
  const fixture = musicFixture();
  // A continuous chirp has no phrase recurrence and no phase-aligned matching seam.
  const right = Float32Array.from(fixture.channels[0], (_, i) => .3 * Math.sin(2 * Math.PI * (180 * i / fixture.rate + 1.7 * (i / fixture.rate) ** 2)));
  assert.deepEqual(analyzeMusicalLoops([fixture.channels[0], right], fixture.rate).loops, []);
});

test('repeating music with independent stereo ambience does not require sample-identical phrases', () => {
  const fixture = musicFixture(); let seed = 721;
  for (const channel of fixture.channels) for (let i = 0; i < channel.length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    channel[i] += seed / 2147483648 * .03;
  }
  const report = analyzeMusicalLoops(fixture.channels, fixture.rate);
  assert.equal(report.loops.length, 1);
  const loop = report.loops[0];
  assert.equal(loop.boundaryMethod, 'musical');
  assert.ok(loop.boundaryError > Math.sqrt(.035), 'Regression: the old 50 ms waveform gate rejected this phrase');
  assert.ok(loop.levelError <= .03 && loop.seamError <= .06);
  assert.ok(Math.abs(loop.end - loop.start - 8) < .006, 'Refinement must preserve musical timing');
});

test('MP3 encoding does not destroy a known four-bar musical loop', async () => {
  const fixture = musicFixture({ rate: 44100 }), folder = await mkdtemp(path.join(os.tmpdir(), 'cation-loop-codec-'));
  const codec = new AudioCodec(path.resolve('node_modules/ffmpeg-static/ffmpeg.exe'));
  try {
    const file = path.join(folder, 'music.mp3');
    await writeFile(file, await codec.encode({ data: encodeWave(fixture.channels, fixture.rate), format: 'mp3', quality: 'high', sampleRate: 0 }));
    const audio = decodeWave(await codec.decode(file)), report = analyzeMusicalLoops(audio.channels, audio.sampleRate);
    assert.equal(report.loops.length, 1); assert.ok(Math.abs(report.bpm - 120) < .5);
    assert.ok(Math.abs(report.loops[0].end - report.loops[0].start - 8) < .002);
    assert.ok(report.loops[0].boundaryError < .05);
  } finally { codec.dispose(); await rm(folder, { recursive: true, force: true }); }
});

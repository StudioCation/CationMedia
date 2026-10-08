// Conservative musical loops: spectral novelty -> local pulse -> bar-length
// recurrence -> sample-level stereo continuity. No fallback to arbitrary zero crossings.
// References: AudioLabs FMP C6 (novelty/tempo) and C4 (music self-similarity).
const FFT_SIZE = 1024, HOP = 128, BANDS = 24, WIDTH = BANDS + 12;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

function fftPlan() {
  const reverse = new Uint16Array(FFT_SIZE), window = new Float32Array(FFT_SIZE);
  const cos = new Float64Array(FFT_SIZE / 2), sin = new Float64Array(FFT_SIZE / 2);
  for (let i = 0; i < FFT_SIZE; i++) {
    let x = i, reversed = 0; for (let b = 0; b < 10; b++) { reversed = reversed * 2 + (x & 1); x >>= 1; }
    reverse[i] = reversed; window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1));
    if (i < FFT_SIZE / 2) { cos[i] = Math.cos(2 * Math.PI * i / FFT_SIZE); sin[i] = -Math.sin(2 * Math.PI * i / FFT_SIZE); }
  }
  return { reverse, window, cos, sin };
}

function features(channels, sampleRate) {
  const stride = Math.max(1, Math.floor(sampleRate / 8000)), rate = sampleRate / stride;
  const count = Math.ceil(channels[0].length / stride), frames = Math.ceil(count / HOP);
  const reduced = channels.map(channel => {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) { let sum = 0; const end = Math.min(channel.length, (i + 1) * stride); for (let j = i * stride; j < end; j++) sum += channel[j]; values[i] = sum / (end - i * stride); }
    return values;
  });
  const plan = fftPlan(), re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE), power = new Float64Array(FFT_SIZE / 2);
  const bins = new Uint8Array(FFT_SIZE / 2), pitches = new Int8Array(FFT_SIZE / 2).fill(-1);
  for (let k = 1; k < bins.length; k++) {
    const hz = k * rate / FFT_SIZE;
    bins[k] = clamp(Math.floor(Math.log(hz / 35) / Math.log((rate / 2) / 35) * BANDS), 0, BANDS - 1);
    if (hz >= 100 && hz <= 3000) pitches[k] = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12;
  }
  const vectors = new Float32Array(frames * WIDTH), levels = new Float32Array(frames), novelty = new Float32Array(frames), bass = new Float32Array(frames);
  const previous = new Float32Array(BANDS);
  for (let f = 0; f < frames; f++) {
    power.fill(0);
    // Sum channel powers, never waveforms: opposite stereo phase cannot cancel a beat.
    for (const channel of reduced) {
      im.fill(0);
      for (let i = 0; i < FFT_SIZE; i++) re[plan.reverse[i]] = (channel[f * HOP + i - FFT_SIZE / 2] || 0) * plan.window[i];
      for (let size = 2; size <= FFT_SIZE; size *= 2) {
        const half = size / 2, step = FFT_SIZE / size;
        for (let start = 0; start < FFT_SIZE; start += size) for (let j = 0; j < half; j++) {
          const a = start + j, b = a + half, c = plan.cos[j * step], s = plan.sin[j * step];
          const tr = c * re[b] - s * im[b], ti = s * re[b] + c * im[b];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
      for (let k = 1; k < power.length; k++) power[k] += (re[k] ** 2 + im[k] ** 2) / (FFT_SIZE ** 2 * channels.length);
    }
    const offset = f * WIDTH;
    let energy = 0;
    for (let k = 1; k < power.length; k++) {
      energy += power[k]; vectors[offset + bins[k]] += power[k];
      if (pitches[k] >= 0) vectors[offset + BANDS + pitches[k]] += power[k];
    }
    levels[f] = Math.sqrt(energy);
    let bandNorm = 0, chromaNorm = 0;
    for (let b = 0; b < BANDS; b++) {
      const magnitude = Math.sqrt(vectors[offset + b]), compressed = Math.log1p(100 * magnitude);
      const flux = Math.max(0, compressed - previous[b]); novelty[f] += flux; if (b < 10) bass[f] += flux;
      previous[b] = compressed; vectors[offset + b] = magnitude; bandNorm += magnitude * magnitude;
    }
    for (let c = 0; c < 12; c++) { const i = offset + BANDS + c; vectors[i] = Math.sqrt(vectors[i]); chromaNorm += vectors[i] ** 2; }
    bandNorm = Math.sqrt(bandNorm) || 1; chromaNorm = Math.sqrt(chromaNorm) || 1;
    for (let b = 0; b < WIDTH; b++) vectors[offset + b] /= b < BANDS ? bandNorm : chromaNorm;
  }
  const fps = rate / HOP, radius = Math.ceil(fps * .15), prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + novelty[i];
  for (let i = 0; i < frames; i++) { const a = Math.max(0, i - radius), b = Math.min(frames, i + radius + 1); novelty[i] = Math.max(0, novelty[i] - (prefix[b] - prefix[a]) / (b - a)); }
  return { vectors, levels, novelty, bass, fps, frames };
}

function pulse(data, from, to) {
  const { novelty: onset, fps } = data, minLag = Math.floor(fps * 60 / 185), maxLag = Math.ceil(fps * 60 / 65);
  const correlations = new Float32Array(maxLag + 2);
  let energy = 0, peak = 0; for (let i = from; i < to; i++) { energy += onset[i] ** 2; peak = Math.max(peak, onset[i]); }
  if (peak < .08 || energy / (to - from) < .002) return null;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = from + lag; i < to; i++) { xy += onset[i] * onset[i - lag]; xx += onset[i] ** 2; yy += onset[i - lag] ** 2; }
    correlations[lag] = xy / Math.sqrt(xx * yy || 1);
  }
  let lag = 0, best = 0;
  for (let i = minLag; i <= maxLag; i++) {
    if (correlations[i] < correlations[i - 1] || correlations[i] < correlations[i + 1]) continue;
    const bpm = fps * 60 / i, score = correlations[i] * (bpm >= 85 && bpm <= 155 ? 1 : .9);
    if (score > best) { best = score; lag = i; }
  }
  if (!lag || correlations[lag] < .48) return null;
  const denom = correlations[lag - 1] - 2 * correlations[lag] + correlations[lag + 1];
  let period = lag + (denom ? clamp(.5 * (correlations[lag - 1] - correlations[lag + 1]) / denom, -.5, .5) : 0);
  let phase = 0, phaseScore = -1;
  const nearby = (center, radius) => {
    let at = Math.round(center), score = -1;
    for (let j = Math.max(from, Math.round(center - radius)); j <= Math.min(to - 1, Math.round(center + radius)); j++) {
      const value = onset[j] * Math.exp(-(((j - center) / (radius || 1)) ** 2));
      if (value > score) { at = j; score = value; }
    }
    return at;
  };
  for (let p = 0; p < period; p += .5) {
    let score = 0; for (let f = from + p; f < to; f += period) score += onset[nearby(f, 2)];
    if (score > phaseScore) { phaseScore = score; phase = from + p; }
  }
  let observations = [];
  for (let f = phase, k = 0; f < to; f += period, k++) { const at = nearby(f, period * .12); if (onset[at] > peak * .16) observations.push([k, at]); }
  if (observations.length < 10 || observations.length / ((to - phase) / period) < .7) return null;
  // Fit fractional-frame spacing; endpoint accuracy must not accumulate FFT-hop rounding.
  let sx = 0, sy = 0, xx = 0, xy = 0;
  for (const [x, y] of observations) { sx += x; sy += y; xx += x * x; xy += x * y; }
  const n = observations.length; period = (n * xy - sx * sy) / (n * xx - sx * sx); phase = (sy - period * sx) / n;
  const timingError = Math.sqrt(observations.reduce((sum, [x, y]) => sum + (y - phase - x * period) ** 2, 0) / n) / period;
  if (timingError > .045) return null;
  const beats = []; for (let f = phase; f < to; f += period) if (f >= from) beats.push(f);
  return { beats, period, bpm: fps * 60 / period, confidence: correlations[lag], timingError };
}

function distance(data, a, b) {
  a = Math.round(a); b = Math.round(b);
  if (a < 0 || b < 0 || a >= data.frames || b >= data.frames) return null;
  let bands = 0, chroma = 0;
  for (let k = 0; k < WIDTH; k++) { const dot = data.vectors[a * WIDTH + k] * data.vectors[b * WIDTH + k]; if (k < BANDS) bands += dot; else chroma += dot; }
  const level = Math.abs(Math.log((data.levels[a] + 1e-6) / (data.levels[b] + 1e-6)));
  return { spectral: Math.max(0, 1 - bands), harmonic: Math.max(0, 1 - chroma), level };
}

function contextMatch(data, a, b, span, points = 24) {
  let spectral = 0, harmonic = 0, level = 0, count = 0;
  for (let i = 0; i <= points; i++) {
    const d = distance(data, a + span * i / points, b + span * i / points); if (!d) continue;
    spectral += d.spectral; harmonic += d.harmonic; level += d.level; count++;
  }
  if (count < points * .85) return null;
  return { spectral: spectral / count, harmonic: harmonic / count, level: level / count };
}
const quality = match => match ? match.spectral + match.harmonic + match.level * .25 : Infinity;
const reliable = (m, scale = 1) => m && m.spectral < .065 * scale && m.harmonic < .045 * scale && m.level < .2 * scale;

function phraseDistance(data, a, b) {
  // Interpolate feature frames so sub-frame boundary refinement does not make
  // an identical MP3 phrase appear different just because of FFT-hop rounding.
  const ai = Math.floor(a), bi = Math.floor(b), af = a - ai, bf = b - bi;
  if (ai < 0 || bi < 0 || ai + 1 >= data.frames || bi + 1 >= data.frames) return null;
  const dot = [0, 0], aa = [0, 0], bb = [0, 0];
  for (let k = 0; k < WIDTH; k++) {
    const x = data.vectors[ai * WIDTH + k] * (1 - af) + data.vectors[(ai + 1) * WIDTH + k] * af;
    const y = data.vectors[bi * WIDTH + k] * (1 - bf) + data.vectors[(bi + 1) * WIDTH + k] * bf;
    const band = k < BANDS ? 0 : 1;
    dot[band] += x * y; aa[band] += x * x; bb[band] += y * y;
  }
  const levelA = data.levels[ai] * (1 - af) + data.levels[ai + 1] * af;
  const levelB = data.levels[bi] * (1 - bf) + data.levels[bi + 1] * bf;
  return { spectral: 1 - dot[0] / Math.sqrt(aa[0] * bb[0] || 1), harmonic: 1 - dot[1] / Math.sqrt(aa[1] * bb[1] || 1), level: Math.abs(Math.log((levelA + 1e-6) / (levelB + 1e-6))) };
}

function samePhrase(data, a, b) {
  const aSpan = (a.end - a.start) * data.fps, bSpan = (b.end - b.start) * data.fps;
  const ratio = Math.max(aSpan, bSpan) / Math.min(aSpan, bSpan);
  if (Math.abs(ratio - Math.round(ratio)) > .03) return false;
  // Only near-identical copies are duplicates. General musical compatibility
  // is intentionally much broader: arrangements can share rhythm and harmony.
  // Compare circular bar rotations as well as duplicated phrase lengths.
  for (let rotation = 0; rotation < b.bars; rotation++) for (let offset = -2; offset <= 2; offset += .25) {
    let spectral = 0, harmonic = 0, level = 0;
    for (let i = 0; i < 48; i++) {
      const elapsed = i / 48 * Math.max(aSpan, bSpan);
      const d = phraseDistance(data, a.start * data.fps + elapsed % aSpan, b.start * data.fps + ((elapsed + rotation / b.bars * bSpan + offset) % bSpan + bSpan) % bSpan);
      if (!d) { spectral = Infinity; break; }
      spectral += d.spectral; harmonic += d.harmonic; level += d.level;
    }
    if (reliable({ spectral: spectral / 48, harmonic: harmonic / 48, level: level / 48 }, .4)) return true;
  }
  return false;
}

function meter(data, beats) {
  const scores = [];
  for (const size of [4, 3]) {
    const accents = Array.from({ length: size }, () => []); let recurrence = 0, count = 0;
    for (let i = 0; i < beats.length; i++) {
      const f = Math.round(beats[i]); accents[i % size].push(data.bass[f]);
      if (i >= size) { recurrence += quality(distance(data, beats[i] + 2, beats[i - size] + 2)); count++; }
    }
    const means = accents.map(values => values.reduce((a, b) => a + b, 0) / (values.length || 1));
    const max = Math.max(...means), min = Math.min(...means), accent = (max - min) / (max + .001);
    scores.push({ size, phase: means.indexOf(max), score: recurrence / (count || 1) - accent * .15 + (size === 4 ? 0 : .015) });
  }
  return scores.sort((a, b) => a.score - b.score)[0];
}

function refineMusicalJoin(channels, rate, start, end, bpm, boundaryError) {
  const i = Math.round(start * rate), j = Math.round(end * rate), half = Math.round(rate * .025);
  const shift = Math.round(rate * .020), delta = Math.round(rate * Math.min(.005, .015 * 60 / bpm));
  const step = Math.max(1, Math.round(rate / 11025));
  if (i < half + shift || j + half + shift + delta >= channels[0].length) return null;
  const rms = channels.map(x => {
    let sum = 0; for (let k = -half; k < half; k++) sum += x[i + k] ** 2 + x[j + k] ** 2;
    return Math.sqrt(sum / (4 * half)) + 1e-6;
  });
  const measure = (a, b) => {
    let levelError = 0, slopeError = 0;
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c];
      levelError = Math.max(levelError, Math.abs(x[a] - x[b]) / rms[c]);
      slopeError = Math.max(slopeError, Math.abs((x[a + 1] - x[a]) - (x[b] - x[b - 1])) / rms[c]);
    }
    return { levelError, slopeError, seamError: levelError + .15 * slopeError };
  };
  let best = { seamError: Infinity }, a = i, b = j;
  const consider = (x, y) => {
    if (Math.abs(x - i) > shift || Math.abs((y - x) - (j - i)) > delta) return;
    const error = measure(x, y);
    if (error.seamError < best.seamError) { best = error; a = x; b = y; }
  };
  // Noise/reverb are not sample-identical between musical repetitions. Match
  // the actual join in both channels while retaining the whole-bar duration.
  for (let s = -shift; s <= shift; s += step) for (let d = -delta; d <= delta; d += step) consider(i + s, j + s + d);
  const coarseA = a, coarseB = b;
  for (let x = coarseA - step; x <= coarseA + step; x++) for (let y = coarseB - step; y <= coarseB + step; y++) consider(x, y);
  if (best.levelError > .03 || best.slopeError > .25 || best.seamError > .06) return null;
  return { start: a / rate, end: b / rate, boundaryError, ...best, boundaryMethod: 'musical' };
}

function refineBoundary(channels, rate, start, end, bpm) {
  const i = Math.round(start * rate), nominal = Math.round(end * rate), radius = Math.round(rate * .025), step = Math.max(1, Math.floor(rate / 6000));
  const half = Math.round(rate * .025), sampleStep = Math.max(1, Math.floor(rate / 2500));
  const mismatch = j => {
    let worst = 0;
    for (const channel of channels) {
      let error = 0, energy = 0;
      for (let k = -half; k < half; k += sampleStep) { const a = channel[i + k], b = channel[j + k]; error += (a - b) ** 2; energy += a * a + b * b; }
      if (energy > 1e-8) worst = Math.max(worst, error / energy);
    }
    return worst;
  };
  if (i < half + radius || nominal + half + radius >= channels[0].length) return null;
  let best = Infinity, at = nominal;
  for (let j = nominal - radius; j <= nominal + radius; j += step) { const error = mismatch(j); if (error < best) { best = error; at = j; } }
  const coarse = at;
  for (let j = coarse - step; j <= coarse + step; j++) { const error = mismatch(j); if (error < best) { best = error; at = j; } }
  if (best > .035) return refineMusicalJoin(channels, rate, start, end, bpm, Math.sqrt(best));
  // Shift both boundaries together, preserving musical duration, to reduce the
  // level/slope discontinuity in every channel. Do not alter or crossfade samples.
  const rms = channels.map(channel => { let sum = 0; for (let k = -half; k < half; k++) sum += channel[i + k] ** 2; return Math.sqrt(sum / (2 * half)) + 1e-6; });
  let shift = 0, seam = Infinity;
  for (let d = -Math.round(rate * .008); d <= Math.round(rate * .008); d++) {
    let error = 0;
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c], level = Math.abs(x[i + d] - x[at + d]);
      const slope = Math.abs((x[i + d + 1] - x[i + d]) - (x[at + d] - x[at + d - 1]));
      error = Math.max(error, (level + slope * .5) / rms[c]);
    }
    if (error < seam) { seam = error; shift = d; }
  }
  if (seam > .08) return refineMusicalJoin(channels, rate, start, end, bpm, Math.sqrt(best));
  const levelError = Math.max(...channels.map((x, c) => Math.abs(x[i + shift] - x[at + shift]) / rms[c]));
  if (levelError > .03) return refineMusicalJoin(channels, rate, start, end, bpm, Math.sqrt(best));
  return { start: (i + shift) / rate, end: (at + shift) / rate, boundaryError: Math.sqrt(best), seamError: seam, levelError, boundaryMethod: 'waveform' };
}


// Recover syncopated phrases using their complete onset pattern, rather than
// requiring a strong attack on every beat. Tempo/meter come from supported grids.
function phraseCandidates(data, lower, upper, bpm, beatsPerBar) {
  if (!bpm || !beatsPerBar) return [];
  // Overlap analysis windows enough to catch phrases around arrangement changes.
  // A 12-second step can miss the only window with a reliable onset pattern.
  const result = [], hop = Math.round(data.fps * 4), window = Math.round(data.fps * 20);
  const onset = data.novelty;
  for (let left = lower; left < upper - data.fps * 10; left += hop) {
    const right = Math.min(upper, left + window);
    if (pulse(data, left, right)) continue;
    for (const bars of [2, 4, 8]) {
      const nominal = data.fps * 60 / bpm * beatsPerBar * bars;
      if (nominal / data.fps < 4 || nominal / data.fps > 20 || right - left < nominal * 2) continue;
      const radius = Math.max(2, Math.ceil(nominal * .02)), scores = new Map();
      for (let lag = Math.round(nominal) - radius; lag <= Math.round(nominal) + radius; lag++) {
        let xy = 0, xx = 0, yy = 0;
        for (let f = left; f < right - lag; f++) { xy += onset[f] * onset[f + lag]; xx += onset[f] ** 2; yy += onset[f + lag] ** 2; }
        scores.set(lag, xy / Math.sqrt(xx * yy || 1));
      }
      const [lag, correlation] = [...scores].sort((a,b) => b[1]-a[1])[0];
      if (correlation < .6 || !scores.has(lag - 1) || !scores.has(lag + 1)) continue;
      const denominator = scores.get(lag - 1) - 2 * correlation + scores.get(lag + 1);
      const span = lag + (denominator ? clamp(.5 * (scores.get(lag - 1) - scores.get(lag + 1)) / denominator, -.5, .5) : 0);
      const localBpm = 60 * data.fps * beatsPerBar * bars / span;
      let peak = 0; for (let f = left; f < right; f++) peak = Math.max(peak, onset[f]);
      for (let f = left + 1; f < right - span - 1; f++) {
        if (onset[f] < Math.max(.08, peak * .16) || onset[f] < onset[f - 1] || onset[f] < onset[f + 1]) continue;
        for (const shift of [-1, 0, 1]) {
          const start = f + shift, end = start + span;
          if (start < lower || end > upper) continue;
          const boundary = contextMatch(data, start - .025 * data.fps, end - .025 * data.fps, .05 * data.fps, 12);
          if (!reliable(boundary)) continue;
          const next = contextMatch(data, start, end, span, 96), previous = contextMatch(data, start - span, start, span, 96);
          const repetition = quality(next) < quality(previous) ? next : previous;
          // A repeated onset pattern permits timbral variation across the whole
          // arrangement. Chroma and loudness still have independent limits; the
          // short join context and original-sample stereo checks remain strict.
          if (!repetition || repetition.spectral > .12 || repetition.harmonic > .045 || repetition.level > .26) continue;
          result.push({ start: start / data.fps, end: end / data.fps, bpm: localBpm, bars, beatsPerBar, rhythmConfidence: correlation, score: quality(boundary) + quality(repetition), analysisSeconds: 0, rhythmMethod: 'phrase' });
        }
      }
    }
    if (right === upper) break;
  }
  return result;
}

export function analyzeMusicalLoops(channels, sampleRate, from = 0, to = channels[0].length / sampleRate) {
  const duration = channels[0].length / sampleRate;
  from = clamp(from, 0, duration); to = clamp(to, from, duration);
  if (to - from < 6) return { loops: [], reason: 'Select at least 6 seconds of rhythmic music.' };
  const data = features(channels, sampleRate), candidates = [], pulses = [];
  const diagnostics = { stableWindows: 0, barCandidates: 0, boundaryMatches: 0, repeatingPhrases: 0, sampleMatches: 0, duplicatePhrases: 0 };
  const lower = Math.ceil(from * data.fps), upper = Math.min(data.frames, Math.floor(to * data.fps));
  // Long windows retain established phrases; shorter windows recover sections
  // separated by fills or arrangement changes. Reuse the same spectral data.
  for (const windowSeconds of [28, 20, 14]) {
    const window = Math.round(data.fps * windowSeconds), hop = Math.round(data.fps * (windowSeconds === 28 ? 12 : 4));
    for (let left = lower; left < upper - data.fps * 6; left += hop) {
      const right = Math.min(upper, left + window), tracked = pulse(data, left, right); if (!tracked) continue;
      pulses.push(tracked.bpm);
      diagnostics.stableWindows++;
      const signature = meter(data, tracked.beats), { beats, period } = tracked;
      for (let a = signature.phase; a < beats.length; a += signature.size) for (const bars of [1, 2, 4, 8]) {
        const b = a + bars * signature.size; if (b >= beats.length) continue;
        const start = beats[a], end = beats[b], seconds = (end - start) / data.fps;
        if (seconds < 4 || seconds > 20) continue;
        diagnostics.barCandidates++;
        if (data.levels[Math.round(start)] < .001 || data.levels[Math.round(end)] < .001) continue;
        const boundary = contextMatch(data, start - period, end - period, period * 2);
        if (!reliable(boundary)) continue;
        diagnostics.boundaryMatches++;
        // A compatible seam alone is not evidence of a repeatable musical phrase.
        const next = contextMatch(data, start, end, end - start), previous = contextMatch(data, start - (end - start), start, end - start);
        const repetition = quality(next) < quality(previous) ? next : previous;
        if (!reliable(repetition, 1.3)) continue;
        diagnostics.repeatingPhrases++;
        const score = quality(boundary) + quality(repetition) + tracked.timingError;
        candidates.push({ analysisSeconds: windowSeconds, start: start / data.fps, end: end / data.fps, bpm: tracked.bpm, bars, beatsPerBar: signature.size, rhythmConfidence: tracked.confidence, score });
      }
      if (right === upper) break;
    }
  }
  const recovered = phraseCandidates(data, lower, upper, median(pulses), median(candidates.map(candidate => candidate.beatsPerBar)));
  diagnostics.phraseCandidates = recovered.length;
  candidates.push(...recovered);
  const rank = candidate => candidate.score + (candidate.end - candidate.start >= 8 && candidate.end - candidate.start <= 12 ? 0 : .12);
  candidates.sort((a, b) => b.analysisSeconds - a.analysisSeconds || (a.rhythmMethod === 'phrase' && b.rhythmMethod === 'phrase' ? a.start - b.start : 0) || rank(a) - rank(b));
  const loops = [], tried = new Set(); let refinements = 0;
  for (const candidate of candidates) {
    const key = `${Math.round(candidate.start * 10)}:${Math.round(candidate.end * 10)}`;
    if (tried.has(key)) continue; tried.add(key);
    if (loops.some(other => candidate.start < other.end && candidate.end > other.start)) continue;
    // Overlapping candidates must not exhaust the expensive-refinement budget.
    if (++refinements > 100) break;
    const refined = refineBoundary(channels, sampleRate, candidate.start, candidate.end, candidate.bpm); if (!refined) continue;
    diagnostics.sampleMatches++;
    if (refined.start < from || refined.end > to || refined.end - refined.start > 20) continue;
    if (loops.some(other => refined.start < other.end && refined.end > other.start)) continue;
    if (loops.some(other => samePhrase(data, { ...candidate, ...refined }, other))) { diagnostics.duplicatePhrases++; continue; }
    loops.push({ ...candidate, ...refined });
  }
  loops.sort((a, b) => a.start - b.start);
  return { loops, bpm: median(pulses), diagnostics, reason: loops.length ? '' : pulses.length ? 'No reliable musical loops: phrase repetition or stereo boundary match is too weak.' : 'No stable beat grid detected. Try a longer section with a clear rhythm.' };
}

export function findLoops(...args) { return analyzeMusicalLoops(...args).loops; }


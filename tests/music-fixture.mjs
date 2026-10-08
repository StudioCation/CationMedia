// Deterministic, polyphonic bars with kick/snare/hi-hat accents and a four-bar
// harmonic phrase. Known timing is independent of the detector under test.
export function musicFixture({ rate = 16000, bpm = 120, meter = 4, seconds = 65, offset = .35, opposite = false } = {}) {
  const beat = 60 / bpm, phraseLength = Math.round(beat * meter * 4 * rate);
  const phrase = new Float32Array(phraseLength); let seed = 918273;
  for (let i = 0; i < phraseLength; i++) {
    const t = i / rate, beatIndex = Math.floor(t / beat), local = t % beat, bar = Math.floor(beatIndex / meter);
    const chord = [220, 261.6256, 196, 293.6648][bar % 4], inBar = t % (beat * meter);
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0; const noise = seed / 2147483648;
    const accent = beatIndex % meter === 0 ? 1 : .65;
    const kick = .55 * accent * Math.sin(2 * Math.PI * (55 * local + 4 * (1 - Math.exp(-25 * local)))) * Math.exp(-22 * local);
    const snare = beatIndex % meter === 1 ? .23 * noise * Math.exp(-40 * local) : 0;
    const hat = .055 * noise * Math.exp(-90 * (t % (beat / 2)));
    const notes = .09 * (Math.sin(2 * Math.PI * chord * inBar) + .5 * Math.sin(2 * Math.PI * chord * 1.5 * inBar)) * (.5 + .5 * Math.exp(-5 * local));
    phrase[i] = kick + snare + hat + notes;
  }
  const left = new Float32Array(Math.round(rate * seconds)), right = new Float32Array(left.length), begin = Math.round(offset * rate);
  for (let i = begin; i < left.length; i++) { left[i] = phrase[(i - begin) % phraseLength]; right[i] = opposite ? -left[i] : .8 * phrase[(i - begin + 13) % phraseLength]; }
  return { channels: [left, right], rate, bpm, meter, offset, phraseSeconds: phraseLength / rate };
}

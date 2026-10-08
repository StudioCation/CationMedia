// A min/max pyramid bounds waveform drawing work by viewport width, not file length.
export function buildPeaks(channels) {
  return channels.map(channel => {
    let size = 128, count = Math.ceil(channel.length / size);
    let min = new Float32Array(count), max = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let lo = Infinity, hi = -Infinity;
      const end = Math.min(channel.length, (i + 1) * size);
      for (let j = i * size; j < end; j++) { const value = channel[j]; if (value < lo) lo = value; if (value > hi) hi = value; }
      min[i] = lo; max[i] = hi;
    }
    const levels = [{ size, min, max }];
    while (count > 1) {
      const nextCount = Math.ceil(count / 2), nextMin = new Float32Array(nextCount), nextMax = new Float32Array(nextCount);
      for (let i = 0; i < nextCount; i++) { const b = Math.min(i * 2 + 1, count - 1); nextMin[i] = Math.min(min[i * 2], min[b]); nextMax[i] = Math.max(max[i * 2], max[b]); }
      size *= 2; count = nextCount; min = nextMin; max = nextMax; levels.push({ size, min, max });
    }
    return levels;
  });
}

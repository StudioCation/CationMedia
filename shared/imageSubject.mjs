import { checkImage } from './image.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const colorDistance2 = (data, index, color) => {
  const r = data[index] - color[0], g = data[index + 1] - color[1], b = data[index + 2] - color[2];
  return r * r + g * g + b * b;
};

function borderSamples(image) {
  const { width, height } = image;
  const inset = Math.min(4, Math.max(1, Math.floor(Math.min(width, height) / 16)));
  const samples = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < inset || y < inset || x >= width - inset || y >= height - inset) samples.push((y * width + x) * 4);
  }
  return samples;
}

function estimatePalette(image, samples) {
  const bins = new Map(), data = image.data;
  for (const at of samples) {
    const key = (data[at] >> 3) << 10 | (data[at + 1] >> 3) << 5 | data[at + 2] >> 3;
    const bin = bins.get(key) || { count: 0, sums: [0, 0, 0] };
    bin.count++;
    for (let c = 0; c < 3; c++) bin.sums[c] += data[at + c];
    bins.set(key, bin);
  }
  const ranked = [...bins.values()].sort((a, b) => b.count - a.count);
  const center = bin => bin.sums.map(value => value / bin.count);
  const first = center(ranked[0]);
  const secondBin = ranked.find(bin => {
    const candidate = center(bin);
    return candidate.reduce((sum, value, c) => sum + (value - first[c]) ** 2, 0) >= 24 ** 2;
  });
  const refine = seed => {
    const sums = [0, 0, 0]; let count = 0;
    for (const at of samples) if (colorDistance2(data, at, seed) <= 18 ** 2) {
      count++;
      for (let c = 0; c < 3; c++) sums[c] += data[at + c];
    }
    return sums.map(value => value / count);
  };
  return { first: refine(first), second: secondBin ? refine(center(secondBin)) : null };
}

function checkerLine(image, palette, horizontal, fixed) {
  const { width, height, data } = image;
  const length = horizontal ? width : height;
  const labels = new Int8Array(length);
  labels.fill(-1);
  for (let position = 0; position < length; position++) {
    const x = horizontal ? position : fixed, y = horizontal ? fixed : position;
    const at = (y * width + x) * 4;
    const a = colorDistance2(data, at, palette[0]), b = colorDistance2(data, at, palette[1]);
    if (Math.min(a, b) <= 32 ** 2) labels[position] = a <= b ? 0 : 1;
  }
  // A single compressed pixel at a checker boundary must not create a new cell.
  for (let i = 1; i < length - 1; i++) if (labels[i - 1] === labels[i + 1] && labels[i - 1] >= 0) labels[i] = labels[i - 1];
  const runs = [];
  for (let start = 0; start < length;) {
    const label = labels[start]; let end = start + 1;
    while (end < length && labels[end] === label) end++;
    if (label >= 0 && end - start >= 2) runs.push({ start, end, label });
    start = end;
  }
  const lengths = [], transitions = [];
  for (let i = 1; i < runs.length - 1; i++) {
    const previous = runs[i - 1], current = runs[i], next = runs[i + 1];
    if (previous.end === current.start && current.end === next.start && previous.label !== current.label && current.label !== next.label) lengths.push(current.end - current.start);
  }
  for (let i = 1; i < runs.length; i++) {
    if (runs[i - 1].end === runs[i].start && runs[i - 1].label !== runs[i].label) transitions.push(runs[i].start);
  }
  return { lengths, transitions };
}

function regularPeriod(lines) {
  const lengths = lines.flatMap(line => line.lengths).filter(value => value >= 2 && value <= 128);
  if (lengths.length < 6) return null;
  let best = null;
  for (let period = 2; period <= 128; period++) {
    const votes = lengths.filter(length => Math.abs(length - period) <= 1).length;
    const exact = lengths.filter(length => length === period).length;
    if (!best || votes > best.votes || (votes === best.votes && exact > best.exact)) best = { period, votes, exact };
  }
  return best.votes >= Math.max(6, lengths.length * .6) ? best.period : null;
}

function checkerPhase(lines, period) {
  const positions = lines.flatMap(line => line.transitions);
  let bestPhase = 0, bestVotes = -1;
  for (let phase = 0; phase < period; phase++) {
    const votes = positions.filter(position => {
      const difference = Math.abs(position % period - phase);
      return Math.min(difference, period - difference) <= 1;
    }).length;
    if (votes > bestVotes) { bestVotes = votes; bestPhase = phase; }
  }
  return bestPhase;
}

function checkerModel(image, samples, palette) {
  const { width, height, data } = image;
  const xLines = [checkerLine(image, palette, true, 0), checkerLine(image, palette, true, height - 1)];
  const yLines = [checkerLine(image, palette, false, 0), checkerLine(image, palette, false, width - 1)];
  const tileX = regularPeriod(xLines), tileY = regularPeriod(yLines);
  if (!tileX || !tileY) return null;
  const phaseX = checkerPhase(xLines, tileX), phaseY = checkerPhase(yLines, tileY);
  const votes = [0, 0]; let matched = 0;
  for (const at of samples) {
    const x = at / 4 % width, y = Math.floor(at / 4 / width);
    const a = colorDistance2(data, at, palette[0]), b = colorDistance2(data, at, palette[1]);
    if (Math.min(a, b) > 22 ** 2) continue;
    const parity = (Math.floor((x - phaseX) / tileX) + Math.floor((y - phaseY) / tileY)) & 1;
    votes[parity === (a <= b ? 0 : 1) ? 0 : 1]++;
    matched++;
  }
  if (matched < samples.length * .6 || Math.max(...votes) < matched * .8) return null;
  return { palette, tileX, tileY, phaseX, phaseY, parity: votes[0] >= votes[1] ? 0 : 1 };
}

function backgroundModel(image) {
  const samples = borderSamples(image);
  const { first, second } = estimatePalette(image, samples);
  const { data } = image;
  const firstCoverage = samples.filter(at => colorDistance2(data, at, first) <= 32 ** 2).length / samples.length;
  const pairedCoverage = second ? samples.filter(at => Math.min(colorDistance2(data, at, first), colorDistance2(data, at, second)) <= 32 ** 2).length / samples.length : 0;
  if (second && pairedCoverage >= .72) {
    const model = checkerModel(image, samples, [first, second]);
    if (model) return model;
  }
  if (firstCoverage < .68) throw new Error('Auto cutout could not identify a solid or checker background.');
  return { palette: [first] };
}

function backgroundColor(model, x, y) {
  if (model.palette.length === 1) return model.palette[0];
  const parity = (Math.floor((x - model.phaseX) / model.tileX) + Math.floor((y - model.phaseY) / model.tileY) + model.parity) & 1;
  return model.palette[parity];
}

function connectedComponents(mask, width, height, accept) {
  const visited = new Uint8Array(mask.length), queue = [];
  for (let start = 0; start < mask.length; start++) {
    if (visited[start] || !mask[start]) continue;
    queue.length = 0; queue.push(start); visited[start] = 1;
    let touchesBorder = false;
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head], x = at % width, y = Math.floor(at / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (!visited[neighbor] && mask[neighbor]) { visited[neighbor] = 1; queue.push(neighbor); }
      }
    }
    accept(queue, touchesBorder);
  }
}

/**
 * Isolate a subject from a flat or regular two-color checker background.
 * Returns a new RGBA image; rejects ambiguous backgrounds instead of guessing.
 */
export function autoCutout(image) {
  checkImage(image);
  const { width, height, data } = image, count = width * height;
  const model = backgroundModel(image);
  const threshold2 = (model.palette.length === 1 ? 36 : 44) ** 2;
  const candidate = new Uint8Array(count), core = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const at = index * 4;
    if (data[at + 3] === 0) continue;
    const distance = Math.min(...model.palette.map(color => colorDistance2(data, at, color)));
    candidate[index] = Number(distance > threshold2);
  }
  const minArea = Math.max(4, Math.ceil(count / 40_000));
  let area = 0;
  connectedComponents(candidate, width, height, component => {
    if (component.length < minArea) return;
    for (const index of component) core[index] = 1;
    area += component.length;
  });
  if (area < minArea || area > count * .9) throw new Error('Auto cutout could not distinguish the subject from the background.');

  // Retain small enclosed highlights and other details that happen to match the backdrop.
  const inverse = new Uint8Array(count);
  for (let index = 0; index < count; index++) inverse[index] = 1 - core[index];
  connectedComponents(inverse, width, height, (component, touchesBorder) => {
    if (!touchesBorder && component.length <= Math.max(4, Math.ceil(count / 1000))) {
      for (const index of component) core[index] = 1;
    }
  });

  const interior = new Uint8Array(count);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const at = y * width + x;
    interior[at] = Number(core[at] && core[at - width - 1] && core[at - width] && core[at - width + 1] && core[at - 1] && core[at + 1] && core[at + width - 1] && core[at + width] && core[at + width + 1]);
  }
  const result = { width, height, data: new Uint8ClampedArray(data.length) };
  const radius = 3;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, at = index * 4;
    let nearest = -1, nearestDistance = Infinity, nearOther = false;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx, distance = dx * dx + dy * dy;
      if (distance > radius * radius) continue;
      if (core[neighbor] !== core[index]) nearOther = true;
    }
    if (!nearOther && core[index]) {
      result.data.set(data.subarray(at, at + 4), at);
      continue;
    }
    if (!nearOther && !core[index]) continue;
    let bestScore = -Infinity;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const nx = x + dx, ny = y + dy, distance = dx * dx + dy * dy;
      if (distance > 25 || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      if (!interior[neighbor]) continue;
      const strength = Math.sqrt(Math.min(...model.palette.map(color => colorDistance2(data, neighbor * 4, color))));
      const score = strength - 5 * Math.sqrt(distance);
      if (score > bestScore) { bestScore = score; nearest = neighbor; }
    }
    if (nearest < 0) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx, distance = dx * dx + dy * dy;
        if (core[neighbor] && distance < nearestDistance) { nearest = neighbor; nearestDistance = distance; }
      }
    }
    if (nearest < 0) continue;
    const fgAt = nearest * 4, bg = backgroundColor(model, x, y);
    let numerator = 0, denominator = 0;
    for (let c = 0; c < 3; c++) {
      const direction = data[fgAt + c] - bg[c];
      numerator += (data[at + c] - bg[c]) * direction;
      denominator += direction * direction;
    }
    const alpha = denominator >= 30 ** 2 ? clamp(numerator / denominator) : Number(core[index]);
    const originalAlpha = data[at + 3] / 255;
    result.data[at + 3] = Math.round(alpha * originalAlpha * 255);
    if (result.data[at + 3]) for (let c = 0; c < 3; c++) result.data[at + c] = alpha > .98 && core[index] ? data[at + c] : data[fgAt + c];
  }
  return result;
}

export const removeBakedChecker = autoCutout;

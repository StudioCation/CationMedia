export const MAX_AUDIO_BYTES = 256 * 1024 * 1024;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function encodeWave(channels, sampleRate) {
  const frames = channels[0]?.length;
  if (!frames || channels.length > 8 || channels.some(c => c.length !== frames) || frames * channels.length * 4 > MAX_AUDIO_BYTES) throw new Error('Audio exceeds the 256 MB decoded limit or has no samples.');
  const data = new Uint8Array(44 + frames * channels.length * 4), view = new DataView(data.buffer);
  const text = (at, str) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, data.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, channels.length, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 4, true); view.setUint16(32, channels.length * 4, true); view.setUint16(34, 32, true);
  text(36, 'data'); view.setUint32(40, data.length - 44, true);
  for (let i = 0, p = 44; i < frames; i++) for (const channel of channels) { view.setFloat32(p, channel[i], true); p += 4; }
  return data;
}
export function decodeWave(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('Invalid WAV data.');
  let format, channels, rate, bits, offset, size, block;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = text(p, 4), length = view.getUint32(p + 4, true), start = p + 8;
    if (start + length > bytes.length) throw new Error('Truncated WAV data.');
    if (id === 'fmt ' && length >= 16) {
      format = view.getUint16(start, true); channels = view.getUint16(start + 2, true); rate = view.getUint32(start + 4, true); block = view.getUint16(start + 12, true); bits = view.getUint16(start + 14, true);
      if (format === 65534 && length >= 40) format = view.getUint16(start + 24, true);
    }
    if (id === 'data') { offset = start; size = length; }
    p = start + length + (length % 2);
  }
  if (!offset || !size || !channels || channels > 8 || rate < 8000 || rate > 192000 || format !== 3 || bits !== 32 || block !== channels * 4 || size % block || size > MAX_AUDIO_BYTES) throw new Error('Unsupported decoded audio. Use a mono/stereo audio file under 256 MB decoded.');
  const frames = size / block, result = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0, p = offset; i < frames; i++) for (const channel of result) { const value = view.getFloat32(p, true); channel[i] = Number.isFinite(value) ? value : 0; p += 4; }
  return { channels: result, sampleRate: rate };
}
export function audioFilter(effect, value, duration) {
  value = Number(value);
  if (!Number.isFinite(value)) throw new Error('Invalid effect value.');
  const bounded = (min, max) => { if (value < min || value > max) throw new Error('Effect value is out of range.'); return value; };
  switch (effect) {
    case 'pitch': return `rubberband=pitch=${2 ** (bounded(-24, 24) / 12)}`;
    case 'stretch': return `rubberband=tempo=${100 / bounded(25, 400)}`;
    case 'gain': return `volume=${bounded(0, 1600) / 100}`;
    case 'chorus': { const mix = bounded(0, 100) / 100; return mix === 0 ? 'anull' : `asplit=2[dry][wet];[dry]volume=${1 - mix}[d];[wet]chorus=0.6:0.8:40|55|70:0.25|0.3|0.2:0.3|0.4|0.5:2|2.3|1.3,volume=${mix}[w];[d][w]amix=inputs=2:normalize=0`; }
    case 'distortion': return `volume=${1 + bounded(0, 100) / 8},asoftclip=type=tanh:threshold=0.8:output=0.8`;
    case 'smooth': return `lowpass=f=${Math.round(18000 * (1 - bounded(0, 100) / 110))}:poles=2`;
    case 'fade-in': return `afade=t=in:st=0:d=${Math.min(bounded(0.001, 600), duration)}`;
    case 'fade-out': { const d = Math.min(bounded(0.001, 600), duration); return `afade=t=out:st=${Math.max(0, duration - d)}:d=${d}`; }
    case 'reverse': return 'areverse';
    default: throw new Error('Unknown audio effect.');
  }
}
// Apply a full-selection linear envelope without changing channel lengths.
export function fadeSelection(channels, direction) {
  if (!['in', 'out'].includes(direction)) throw new Error('Unknown fade direction.');
  return channels.map(channel => {
    const result = new Float32Array(channel.length), last = Math.max(1, channel.length - 1);
    for (let i = 0; i < channel.length; i++) result[i] = channel[i] * (direction === 'in' ? i / last : 1 - i / last);
    return result;
  });
}
export { findLoops } from './audioLoopAnalysis.mjs';

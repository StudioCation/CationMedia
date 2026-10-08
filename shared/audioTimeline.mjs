// Clip trim points are sample indices; the source buffers remain untouched.
export function clipRange(clip) {
  const length = clip.channels[0].length;
  const from = Math.max(0, Math.min(length - 1, clip.trimStart || 0));
  const to = Math.max(from + 1, Math.min(length, clip.trimEnd ?? length));
  return { from, to, duration: (to - from) / clip.sampleRate };
}
export function clipAudio(clip) {
  const { from, to } = clipRange(clip);
  return { channels: clip.channels.map(channel => channel.subarray(from, to)), sampleRate: clip.sampleRate, start: clip.start, gain: clip.gain ?? 1, muted: Boolean(clip.muted) };
}

export function timelineScale(value, duration, viewportWidth) {
  const fit = viewportWidth > 101 ? (viewportWidth - 101) / duration : 10;
  const minimum = Math.min(10, Math.max(.001, fit));
  return minimum + (Math.max(10, Math.min(200, value)) - 10) / 190 * (200 - minimum);
}
export function trimClip(clip, edge, delta) {
  const { from, to } = clipRange(clip);
  const frames = Math.round(delta * clip.sampleRate);
  if (edge === 'left') {
    const next = Math.max(0, from - Math.floor(clip.start * clip.sampleRate), Math.min(to - 1, from + frames));
    return { trimStart: next, trimEnd: to, start: clip.start + (next - from) / clip.sampleRate };
  }
  return { trimStart: from, trimEnd: Math.max(from + 1, Math.min(clip.channels[0].length, to + frames)), start: clip.start };
}
export function splitClip(clip, time) {
  const { from, to } = clipRange(clip);
  const at = from + Math.round((time - clip.start) * clip.sampleRate);
  if (at <= from || at >= to) return null;
  return [{ trimStart: from, trimEnd: at, start: clip.start }, { trimStart: at, trimEnd: to, start: clip.start + (at - from) / clip.sampleRate }];
}

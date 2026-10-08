import { MAX_AUDIO_BYTES } from './audio.mjs';

// Each clip retains its own sample rate; interpolation also handles imported video audio.
export function mixClips(clips, sampleRate = 48000) {
  if (!clips.length) throw new Error('The timeline is empty.');
  const duration = Math.max(...clips.map(c => c.start + c.channels[0].length / c.sampleRate));
  const count = Math.max(...clips.map(c => c.channels.length));
  const length = Math.ceil(duration * sampleRate);
  if (!Number.isFinite(length) || length < 1 || length * count * 4 > MAX_AUDIO_BYTES) throw new Error('Mix exceeds the 256 MB decoded limit.');
  const channels = Array.from({ length: count }, () => new Float32Array(length));
  for (const clip of clips) {
    if (!Number.isFinite(clip.start) || clip.start < 0 || !Number.isFinite(clip.sampleRate) || clip.sampleRate <= 0) throw new Error('Invalid clip timing.');
    if (clip.muted) continue;
    const offset = Math.round(clip.start * sampleRate), frames = Math.round(clip.channels[0].length * sampleRate / clip.sampleRate);
    for (let ch = 0; ch < count; ch++) {
      const input = clip.channels[ch] || (clip.channels.length === 1 ? clip.channels[0] : null);
      if (!input) continue;
      for (let i = 0; i < frames && offset + i < length; i++) {
        const pos = i * clip.sampleRate / sampleRate, a = Math.min(input.length - 1, Math.floor(pos)), b = Math.min(a + 1, input.length - 1);
        channels[ch][offset + i] += (input[a] + (input[b] - input[a]) * (pos - a)) * (clip.gain ?? 1);
      }
    }
  }
  let peak = 1;
  for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  if (peak > 1) for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] /= peak;
  return { channels, sampleRate, peak };
}

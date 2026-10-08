export const videoProfiles = Object.freeze({
  mp4: { label: 'MP4', codecs: ['libx264', 'libx265', 'libaom-av1'], audio: 'aac' },
  mov: { label: 'MOV', codecs: ['libx264', 'libx265', 'prores_ks'], audio: 'aac' },
  mkv: { label: 'MKV', codecs: ['libx264', 'libx265', 'libvpx-vp9', 'libaom-av1'], audio: 'aac' },
  webm: { label: 'WebM', codecs: ['libvpx-vp9', 'libvpx', 'libaom-av1'], audio: 'libopus' },
  avi: { label: 'AVI', codecs: ['mpeg4', 'mjpeg'], audio: 'libmp3lame' },
  wmv: { label: 'WMV', codecs: ['wmv2'], audio: 'wmav2' },
  mpg: { label: 'MPEG', codecs: ['mpeg2video'], audio: 'mp2' },
  ts: { label: 'MPEG-TS', codecs: ['libx264', 'libx265', 'mpeg2video'], audio: 'aac' },
  ogv: { label: 'Ogg video', codecs: ['libtheora'], audio: 'libvorbis' }
});
export const codecLabels = { libx264: 'H.264', libx265: 'H.265 / HEVC', 'libvpx-vp9': 'VP9', libvpx: 'VP8', 'libaom-av1': 'AV1', prores_ks: 'ProRes 422', mpeg4: 'MPEG-4', mjpeg: 'Motion JPEG', wmv2: 'WMV 8', mpeg2video: 'MPEG-2', libtheora: 'Theora' };
export function videoOptions(raw, info) {
  const profile = videoProfiles[raw.format];
  if (!profile?.codecs.includes(raw.codec)) throw new Error('Unsupported container / codec combination.');
  const number = (value, min, max, name, integer = false) => { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Invalid ${name}.`); return n; };
  const width = number(raw.width, 16, 7680, 'width', true), height = number(raw.height, 16, 4320, 'height', true);
  if (width % 2 || height % 2) throw new Error('Output dimensions must be even.');
  const fps = number(raw.fps, 1, 120, 'FPS'), bitrate = number(raw.bitrate, 100, 200000, 'bitrate');
  if (raw.codec === 'mpeg2video' && ![23.976, 24, 25, 29.97, 30, 50, 59.94, 60].some(rate => Math.abs(rate - fps) < .002)) throw new Error('MPEG-2 requires 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60 FPS.');
  const quality = number(raw.quality ?? 1, .25, 3, 'quality');
  const audioBitrate = number(raw.audioBitrate ?? 192, 64, 320, 'audio bitrate', true);
  if (audioBitrate % 32) throw new Error('Audio bitrate must be a multiple of 32 kbps.');
  const audioRate = number(raw.audioRate ?? 48000, 44100, 48000, 'audio sample rate', true);
  if (![44100, 48000].includes(audioRate)) throw new Error('Choose 44,100 or 48,000 Hz.');
  if (profile.audio === 'libopus' && audioRate !== 48000) throw new Error('Opus requires 48,000 Hz.');
  const audioChannels = number(raw.audioChannels ?? 2, 1, 2, 'audio channels', true);
  if (!['fit', 'fill'].includes(raw.mode)) throw new Error('Invalid fit mode.');
  const crop = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key => [key, number(raw.crop?.[key] ?? 0, 0, key === 'left' || key === 'right' ? info.width : info.height, 'crop', true)]));
  if (info.width - crop.left - crop.right < 2 || info.height - crop.top - crop.bottom < 2) throw new Error('Crop must leave at least 2 × 2 pixels.');
  return { format: raw.format, codec: raw.codec, width, height, fps, bitrate, quality, mode: raw.mode, crop, audio: raw.audio !== false, audioBitrate, audioRate, audioChannels };
}
export function videoGeometry(options, info) {
  const { crop, width, height, mode } = options;
  const sw = info.width - crop.left - crop.right, sh = info.height - crop.top - crop.bottom;
  const scale = (mode === 'fill' ? Math.max : Math.min)(width / sw, height / sh);
  return { sx: crop.left, sy: crop.top, sw, sh, dx: (width - sw * scale) / 2, dy: (height - sh * scale) / 2, dw: sw * scale, dh: sh * scale };
}
export function estimateVideoBytes(options, duration) {
  // ProRes and MJPEG are quality driven; the UI marks this as a rough estimate.
  const bitrate = options.codec === 'prores_ks' ? options.width * options.height * options.fps * (options.quality < .8 ? .15 : options.quality > 1.4 ? .65 : .45) / 1000 : options.bitrate;
  return Math.ceil(duration * (bitrate + (options.audio ? options.audioBitrate ?? 192 : 0)) * 1000 / 8 * 1.025);
}
export function videoEncodeArgs(raw, info) {
  const o = videoOptions(raw, info), c = o.crop;
  const filters = [`crop=${info.width - c.left - c.right}:${info.height - c.top - c.bottom}:${c.left}:${c.top}`];
  filters.push(o.mode === 'fit' ? `scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2` : `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${o.width}:${o.height}`);
  filters.push('setsar=1', `fps=${o.fps}`);
  const args = ['-map', '0:v:0', '-vf', filters.join(','), '-c:v', o.codec];
  if (o.codec === 'prores_ks') args.push('-profile:v', o.quality < .8 ? '0' : o.quality > 1.4 ? '3' : '2', '-pix_fmt', 'yuv422p10le');
  else { args.push('-b:v', `${o.bitrate}k`, '-pix_fmt', o.codec === 'mjpeg' ? 'yuvj420p' : 'yuv420p'); }
  if (['libx264', 'libx265'].includes(o.codec)) args.push('-preset', 'medium');
  if (o.codec === 'libaom-av1') args.push('-cpu-used', '6');
  if (o.codec === 'libvpx-vp9') args.push('-deadline', 'good', '-cpu-used', '4');
  if (o.audio) args.push('-map', '0:a:0?', '-c:a', videoProfiles[o.format].audio, '-b:a', `${o.audioBitrate}k`, '-ar', String(o.audioRate), '-ac', String(o.audioChannels)); else args.push('-an');
  if (['mp4', 'mov'].includes(o.format)) args.push('-movflags', '+faststart');
  return args;
}

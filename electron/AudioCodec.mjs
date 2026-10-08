import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MAX_AUDIO_BYTES, decodeWave, audioFilter } from '../shared/audio.mjs';
import { audioFormats } from '../shared/mediaTypes.mjs';

export class AudioCodec {
  constructor(executable) { this.executable = executable; this.children = new Set(); }
  run(args, output) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { windowsHide: true });
      this.children.add(child); let stderr = '', limit = false;
      const timeout = setTimeout(() => { limit = true; child.kill(); }, 180000);
      const watch = setInterval(async () => { if (output && (await stat(output).catch(() => null))?.size > MAX_AUDIO_BYTES + 4096) { limit = true; child.kill(); } }, 150);
      child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-5000); });
      const cleanup = () => { clearTimeout(timeout); clearInterval(watch); this.children.delete(child); };
      child.on('error', error => { cleanup(); reject(error); });
      child.on('close', code => { cleanup(); if (limit) reject(new Error('Audio processing exceeded the 256 MB / 180 second limit.')); else if (code) reject(new Error(stderr.trim() || 'Audio conversion failed.')); else resolve(); });
    });
  }
  async temporary(callback) {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-audio-'));
    try { return await callback(folder); } finally { await rm(folder, { recursive: true, force: true }); }
  }
  async decode(file) {
    return this.temporary(async folder => {
      const output = path.join(folder, 'decoded.wav');
      await this.run(['-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', output], output);
      if ((await stat(output)).size > MAX_AUDIO_BYTES) throw new Error('Audio exceeds the 256 MB decoded limit.');
      const bytes = new Uint8Array(await readFile(output)); decodeWave(bytes); return bytes;
    });
  }
  validate(data) { if (!(data instanceof Uint8Array) || data.length > MAX_AUDIO_BYTES + 44) throw new Error('Invalid audio data.'); return decodeWave(data); }
  async process(payload) {
    const source = this.validate(payload?.data), duration = source.channels[0].length / source.sampleRate;
    let filter = audioFilter(payload.effect, payload.value, duration);
    // Give Rubber Band a tail to flush its analysis window; edits must have exact duration.
    if (['pitch', 'stretch'].includes(payload.effect)) {
      const target = duration * (payload.effect === 'stretch' ? Number(payload.value) / 100 : 1);
      filter = `apad=pad_dur=0.25,${filter},apad=whole_dur=${target},atrim=duration=${target}`;
    }
    return this.temporary(async folder => {
      const input = path.join(folder, 'input.wav'), output = path.join(folder, 'output.wav'); await writeFile(input, payload.data);
      await this.run(['-i', input, '-af', filter, '-c:a', 'pcm_f32le', output], output);
      const bytes = new Uint8Array(await readFile(output)); this.validate(bytes); return bytes;
    });
  }
  exportOptions(payload) {
    if (!audioFormats.includes(payload?.format) || !['standard', 'high', 'maximum'].includes(payload.quality) || ![0, 22050, 44100, 48000, 96000].includes(payload.sampleRate)) throw new Error('Invalid audio export options.');
    const q = ['standard', 'high', 'maximum'].indexOf(payload.quality), format = payload.format;
    const options = {
      wav: ['-c:a', ['pcm_s16le', 'pcm_s24le', 'pcm_f32le'][q]], aiff: ['-c:a', q ? 'pcm_s24be' : 'pcm_s16be'],
      mp3: ['-c:a', 'libmp3lame', '-b:a', ['128k', '192k', '320k'][q]], flac: ['-c:a', 'flac', '-sample_fmt', q ? 's32' : 's16', '-compression_level', '8'],
      ogg: ['-c:a', 'libvorbis', '-q:a', ['4', '6', '10'][q]], opus: ['-c:a', 'libopus', '-b:a', ['96k', '160k', '256k'][q]],
      m4a: ['-c:a', 'aac', '-b:a', ['128k', '192k', '320k'][q]], aac: ['-c:a', 'aac', '-b:a', ['128k', '192k', '320k'][q]],
      wma: ['-c:a', 'wmav2', '-b:a', ['128k', '192k', '320k'][q]], ac3: ['-c:a', 'ac3', '-b:a', ['192k', '384k', '640k'][q]]
    }[format];
    if (payload.bitrate !== undefined) {
      const min = format === 'ac3' ? 192 : 64, max = format === 'ac3' ? 640 : 320, step = format === 'ac3' ? 64 : 32;
      const bitrate = Number(payload.bitrate), index = options.indexOf('-b:a');
      if (index < 0 || !Number.isInteger(bitrate) || bitrate < min || bitrate > max || bitrate % step) throw new Error('Invalid audio bitrate.');
      options[index + 1] = `${bitrate}k`;
    }
    if (payload.sampleRate) options.push('-ar', String(payload.sampleRate));
    return options;
  }
  async encode(payload) {
    this.validate(payload?.data); const options = this.exportOptions(payload);
    return this.temporary(async folder => {
      const input = path.join(folder, 'input.wav'), output = path.join(folder, `output.${payload.format}`); await writeFile(input, payload.data);
      await this.run(['-i', input, '-map', '0:a:0', ...options, output], output);
      return new Uint8Array(await readFile(output));
    });
  }
  dispose() { for (const child of this.children) child.kill(); }
}

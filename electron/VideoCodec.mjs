import { spawn } from 'node:child_process';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { videoEncodeArgs, videoOptions } from '../shared/video.mjs';

export class VideoCodec {
  constructor(executable) { this.executable = executable; this.children = new Set(); this.folders = new Set(); }
  run(args, { probe = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true });
      this.children.add(child); let output = '', expired = false;
      const timer = setTimeout(() => { expired = true; child.kill(); }, probe ? 30000 : 3600000);
      child.stderr.on('data', bytes => { output = (output + bytes).slice(-32000); });
      const clean = () => { clearTimeout(timer); this.children.delete(child); };
      child.on('error', error => { clean(); reject(error); });
      child.on('close', code => { clean(); if (expired) reject(new Error('Video processing timed out.')); else if (code && !probe) reject(new Error(output.slice(-3000) || 'Video conversion failed.')); else resolve(output); });
    });
  }
  async probe(file) {
    const output = await this.run(['-protocol_whitelist', 'file,pipe', '-i', file], { probe: true });
    const line = output.split('\n').find(l => /Stream.*Video:/.test(l));
    const dimensions = line?.match(/\b(\d{2,5})x(\d{2,5})\b/), duration = output.match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (!dimensions || !duration) throw new Error('Cannot read video dimensions or duration. The file may be damaged or unsupported.');
    let width = Number(dimensions[1]), height = Number(dimensions[2]);
    const rotation = Number(output.match(/rotation of ([-\d.]+)/)?.[1] || 0);
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    const sar = line.match(/SAR (\d+):(\d+)/);
    // Export and preview first normalize non-square source pixels.
    const ratio = sar && Number(sar[2]) ? Number(sar[1]) / Number(sar[2]) : 1;
    if (Math.abs(rotation) % 180 === 90) height = Math.round(height * ratio); else width = Math.round(width * ratio);
    return { width, height, duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]), fps: Number(line.match(/([\d.]+) fps/)?.[1] || 30), codec: line.match(/Video: ([^ ,]+)/)?.[1], hasAudio: /Stream.*Audio:/.test(output) };
  }
  async preview(file, info) {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-video-')); this.folders.add(folder);
    const output = path.join(folder, 'preview.mp4');
    await this.run(['-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=${info.width}:${info.height},setsar=1,scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-movflags', '+faststart', output]);
    return output;
  }
  async extractAudio(file, destination, format, encoding) {
    const folder = await mkdtemp(path.join(path.dirname(destination), '.cation-audio-'));
    try {
      const temporary = path.join(folder, `audio.${format}`);
      await this.run(['-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:a:0', '-vn', ...encoding, temporary]);
      await copyFile(temporary, destination);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  async frame(file, destination, time, raw, info) {
    if (!Number.isFinite(time) || time < 0 || time > info.duration) throw new Error('Invalid frame time.');
    const options = videoOptions(raw, info);
    const args = videoEncodeArgs(options, info);
    const filter = args[args.indexOf('-vf') + 1];
    const folder = await mkdtemp(path.join(path.dirname(destination), '.cation-frame-'));
    try {
      const temporary = path.join(folder, 'frame.png');
      await this.run(['-protocol_whitelist', 'file,pipe', '-ss', String(Math.min(time, Math.max(0, info.duration - 1 / info.fps))), '-i', file, '-map', '0:v:0', '-vf', `scale=${info.width}:${info.height},setsar=1,${filter}`, '-frames:v', '1', '-an', '-c:v', 'png', temporary]);
      await copyFile(temporary, destination);
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  async export(file, destination, raw, info) {
    const options = videoOptions(raw, info);
    const folder = await mkdtemp(path.join(path.dirname(destination), '.cation-video-'));
    try {
      const temporary = path.join(folder, `output.${options.format}`);
      const args = videoEncodeArgs(options, info);
      const filter = args.indexOf('-vf') + 1; args[filter] = `scale=${info.width}:${info.height},setsar=1,${args[filter]}`;
      await this.run(['-protocol_whitelist', 'file,pipe', '-i', file, ...args, temporary]);
      // Conversion must succeed before an existing destination is replaced.
      await copyFile(temporary, destination);
      return destination;
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  async dispose() { for (const child of this.children) child.kill(); await Promise.all([...this.folders].map(folder => rm(folder, { recursive: true, force: true }).catch(() => {}))); }
}

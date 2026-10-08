import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export class BlenderManager {
  constructor(script) { this.script = script; this.jobs = new Set(); this.temp = new Set(); }
  async discover(saved) {
    const candidates = [saved, ...(process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'blender.exe'))];
    const base = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation');
    for (const name of (await readdir(base).catch(() => [])).sort().reverse()) candidates.push(path.join(base, name, 'blender.exe'));
    for (const file of candidates.filter(Boolean)) { try { await access(file); return file; } catch {} }
    throw new Error('Blender was not found. Use Set Blender path to locate blender.exe.');
  }
  async convert(file, saved) {
    const executable = await this.discover(saved);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cation-viewer-'));
    this.temp.add(dir);
    const output = path.join(dir, 'scene.glb');
    await new Promise((resolve, reject) => {
      const child = spawn(executable, ['--background', '--factory-startup', '--disable-autoexec', file, '--python', this.script, '--', output], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.jobs.add(child);
      let log = '';
      const capture = data => { log = (log + data.toString()).slice(-6000); };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      const timer = setTimeout(() => { child.kill(); reject(new Error('Blender conversion timed out after 120 seconds.')); }, 120000);
      child.on('error', error => { clearTimeout(timer); this.jobs.delete(child); reject(error); });
      child.on('close', code => { clearTimeout(timer); this.jobs.delete(child); code === 0 ? resolve() : reject(new Error(`Blender exited with code ${code}. ${log.slice(-1500)}`)); });
    });
    await access(output);
    return output;
  }
  async exportFbx(data, output, saved) {
    const executable = await this.discover(saved);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cation-fbx-'));
    this.temp.add(dir);
    const input = path.join(dir, 'scene.glb'), converted = path.join(dir, 'scene.fbx');
    try {
      await writeFile(input, data);
      await new Promise((resolve, reject) => {
        const script = path.join(path.dirname(this.script), 'fbx_export.py');
        const child = spawn(executable, ['--background', '--factory-startup', '--disable-autoexec', '--python', script, '--', input, converted], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.jobs.add(child);
        let log = '';
        const capture = chunk => { log = (log + chunk.toString()).slice(-6000); };
        child.stdout.on('data', capture); child.stderr.on('data', capture);
        const timer = setTimeout(() => { child.kill(); reject(new Error('FBX conversion timed out after 180 seconds.')); }, 180000);
        child.on('error', error => { clearTimeout(timer); this.jobs.delete(child); reject(error); });
        child.on('close', code => { clearTimeout(timer); this.jobs.delete(child); code === 0 ? resolve() : reject(new Error(`Blender FBX export failed (code ${code}). ${log.slice(-1500)}`)); });
      });
      if (!(await stat(converted)).size) throw new Error('Blender produced an empty FBX file.');
      await copyFile(converted, output);
    } finally {
      this.temp.delete(dir);
      await rm(dir, { recursive: true, force: true });
    }
  }
  async dispose() { for (const child of this.jobs) child.kill(); await Promise.all([...this.temp].map(dir => rm(dir, { recursive: true, force: true }).catch(() => {}))); }
}

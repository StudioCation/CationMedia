import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveAsset } from './files.mjs';
import { isTexture } from './textureFiles.mjs';

// Exactly the model directory, its immediate subdirectories, the parent and its
// immediate subdirectories. No recursive walk and no URLs granted until acceptance.
export async function discoverTextures(file, known = []) {
  const modelRoot = path.dirname(file), root = path.dirname(modelRoot);
  const folders = new Set([modelRoot, root]);
  for (const base of [modelRoot, root]) {
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'release'].includes(entry.name)) folders.add(path.join(base, entry.name));
  }
  const files = [], seen = new Set(known.map(name => path.resolve(name).toLowerCase()));
  for (const folder of folders) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !isTexture(entry.name)) continue;
      try {
        const absolute = await resolveAsset(root, path.relative(root, path.join(folder, entry.name)));
        if (seen.has(absolute.toLowerCase())) continue;
        seen.add(absolute.toLowerCase()); files.push({ name: entry.name, absolute, relative: path.relative(root, absolute) });
      } catch { /* Ignore files outside this explicitly bounded search. */ }
    }
  }
  return { root, files };
}

import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveAsset } from './files.mjs';
import { referencedSidecarTextures } from '../shared/sidecarTextures.mjs';
export const isTexture = name => /\.(png|jpe?g|webp|bmp|gif|psd|tiff?)$/i.test(name);
export async function nearbySidecar(file, baseURL) {
  const root = path.dirname(file), name = path.basename(file).replace(/\.(glb|gltf)$/i, '.json');
  if (!/\.(glb|gltf)$/i.test(file)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const matches = entries.filter(entry => entry.isFile() && entry.name.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1) return [];
  try {
    await resolveAsset(root, matches[0].name);
    return [{ name: matches[0].name, url: baseURL + encodeURIComponent(matches[0].name) }];
  } catch { return []; }
}

// Only explicit, unambiguous JSON references use automatic sibling-file grants.
export async function sidecarTextureFiles(file, sidecars, assets, discovered) {
  if (sidecars.length !== 1) return [];
  try {
    const json = await resolveAsset(path.dirname(file), sidecars[0].name);
    const data = JSON.parse(await readFile(json, 'utf8'));
    // Already available resources take precedence over sibling candidates.
    const local = new Set(referencedSidecarTextures(data, assets).map(asset => asset.name.toLowerCase()));
    return referencedSidecarTextures(data, [...assets, ...discovered.filter(asset => !local.has(asset.name.toLowerCase()))])
      .filter(asset => discovered.includes(asset));
  } catch { return []; } // The renderer reports malformed sidecar JSON.
}
// Deliberately bounded: no recursive disk scan or access outside the granted root.
export async function nearbyTextures(root, baseURL) {
  const files = [];
  for (const folder of ['', 'textures', 'Textures', 'maps', 'Maps']) {
    const entries = await readdir(path.join(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !isTexture(entry.name)) continue;
      const relative = path.join(folder, entry.name);
      try {
        await resolveAsset(root, relative);
        const url = baseURL + relative.split(path.sep).map(encodeURIComponent).join('/');
        if (!files.some(file => file.url.toLowerCase() === url.toLowerCase())) files.push({ name: entry.name, url });
      } catch { /* Ignore symlinks outside the resource grant. */ }
    }
  }
  return files;
}

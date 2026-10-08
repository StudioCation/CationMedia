import { applyTextureSettings } from './TextureSettings.mjs';
import { CanvasTexture, TextureLoader, SRGBColorSpace, NoColorSpace, Color } from 'three';
import { chooseTexture, resolveSidecarTexture } from './textureMatching.mjs';

export async function readPSD(buffer) {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buffer, { skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true, totalMemoryLimit: 256 * 1024 * 1024 });
  if (!psd.canvas) throw new Error('PSD has no composite image. Save it with Maximize Compatibility enabled.');
  return psd.canvas;
}

export async function readTIFF(buffer) {
  const { TIFFLoader } = await import('three/addons/loaders/TIFFLoader.js');
  const { width, height, data } = new TIFFLoader().parse(buffer);
  if (!width || !height || width * height > 64 * 1024 * 1024) throw new Error('Invalid or oversized TIFF image.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

export class PSDLoader {
  constructor(manager, decode = readPSD) { this.manager = manager; this.decode = decode; }
  setPath(path) { this.path = path; return this; }
  load(url, onLoad, onProgress, onError) {
    url = this.manager.resolveURL((this.path || '') + url);
    const texture = new CanvasTexture();
    texture.userData.sourceURL = url;
    this.manager.itemStart(url);
    fetch(url).then(response => { if (!response.ok) throw new Error('Unable to read PSD'); return response.arrayBuffer(); })
      .then(this.decode).then(canvas => { texture.image = canvas; texture.needsUpdate = true; onLoad?.(texture); })
      .catch(error => { this.manager.itemError(url); onError?.(error); })
      .finally(() => this.manager.itemEnd(url));
    return texture;
  }
}

const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];
function resources(materials) {
  const textures = new Set();
  for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  return textures;
}

export class TextureManager {
  async decode(asset) {
    const decode = /\.psd$/i.test(asset.name) ? readPSD : /\.tiff?$/i.test(asset.name) ? readTIFF : null;
    const texture = decode
      ? new CanvasTexture(await decode(await (asset.file ? asset.file.arrayBuffer() : fetch(asset.url).then(r => { if (!r.ok) throw new Error('Unable to read texture'); return r.arrayBuffer(); }))))
      : await new TextureLoader().loadAsync(asset.url);
    texture.name = asset.name;
    return texture;
  }

  async apply(root, assets, { display, selected = root, explicit = false, flipY = true, preserveSidecar = false, repair = false } = {}) {
    if (!assets.length) return { applied: 0, skipped: 0 };
    const edits = [], decoded = new Map(), before = new Set();
    const original = object => display?.original.get(object) ?? object.material;
    root.traverse(object => { for (const material of [original(object)].flat().filter(Boolean)) before.add(material); });
    selected.traverse(object => {
      if (!object.isMesh || !object.geometry.attributes.uv) return;
      for (const [index, material] of [original(object)].flat().entries()) {
        if (!material) continue;
        if (material.userData.viewerSidecar && (!explicit || preserveSidecar) && !repair) continue;
        for (const slot of slots) {
          if (!(slot in material) || (!explicit && material[slot]?.image)) continue;
          // An unresolved named map must not silently receive an unrelated texture.
          if (!explicit && material[slot]) continue;
          const reference = material.userData.viewerTextureRefs?.[slot];
          const asset = repair && reference ? resolveSidecarTexture(reference, null, assets)
            : repair && material.userData.viewerSidecar ? null : chooseTexture(assets, material.name, object.name, slot, explicit);
          if (asset) edits.push({ object, index, material, slot, asset });
        }
      }
    });
    // Decode before changing any material so a broken PSD leaves the model intact.
    try { for (const { asset } of edits) if (!decoded.has(asset)) decoded.set(asset, await this.decode(asset)); }
    catch (error) { for (const texture of decoded.values()) texture.dispose(); throw error; }
    const changed = new Map();
    for (const edit of edits) {
      const { object, index, material, slot, asset } = edit;
      if (!changed.has(object)) changed.set(object, [original(object)].flat().map(item => item.clone()));
      const target = changed.get(object)[index], texture = decoded.get(asset).clone();
      if (material[slot]) {
        texture.copy(material[slot]); texture.source = decoded.get(asset).source; texture.name = asset.name;
      } else texture.flipY = flipY;
      texture.colorSpace = ['map', 'emissiveMap'].includes(slot) ? SRGBColorSpace : NoColorSpace;
      if (!material[slot]) applyTextureSettings(texture, material.userData.viewerTextureSettings?.[slot]);
      texture.needsUpdate = true; target[slot] = texture;
      if (slot === 'map' && !repair) target.color?.set(0xffffff);
      if (slot === 'metalnessMap' && !repair) target.metalness = 1;
      if (slot === 'roughnessMap' && !repair) target.roughness = 1;
      if (slot === 'emissiveMap') { target.emissive = new Color(0xffffff); target.emissiveIntensity = 1; }
      if (slot === 'alphaMap' && target.alphaTest === 0) target.transparent = true;
      target.needsUpdate = true;
    }
    for (const [object, materials] of changed) {
      const replacement = Array.isArray(original(object)) ? materials : materials[0];
      if (display) display.original.set(object, replacement);
      else object.material = replacement;
    }
    if (display) display.set(display.mode);
    const after = new Set();
    root.traverse(object => { for (const material of [original(object)].flat().filter(Boolean)) after.add(material); });
    const retained = resources(after);
    for (const texture of resources(before)) if (!retained.has(texture)) texture.dispose();
    for (const material of before) if (!after.has(material)) material.dispose();
    for (const texture of decoded.values()) texture.dispose();
    return { applied: edits.length, skipped: assets.filter(asset => !decoded.has(asset)).length };
  }
}

export function clearMissingTextures(root) {
  const failed = new Set();
  root.traverse(object => {
    for (const material of [object.material].flat().filter(Boolean)) {
      for (const slot of slots) {
        const texture = material[slot];
        if (texture && !texture.image) {
          const reference = texture.name || texture.userData?.sourceURL;
          if (reference) { material.userData.viewerTextureRefs ||= {}; material.userData.viewerTextureRefs[slot] = reference; }
          failed.add(texture); material[slot] = null; material.needsUpdate = true;
        }
      }
    }
  });
  for (const texture of failed) texture.dispose();
  return failed.size;
}

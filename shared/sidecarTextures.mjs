export const isTexture = name => /\.(png|jpe?g|webp|bmp|gif|psd|tiff?)$/i.test(name);
export function basename(value) {
  try { value = decodeURIComponent(value); } catch {}
  return value.replace(/\\/g, '/').split('/').pop().split(/[?#]/)[0].toLowerCase();
}

export function resolveSidecarTexture(reference, metadata, assets) {
  if (typeof reference !== 'string' || !reference) return null;
  const format = (metadata && Object.hasOwn(metadata, reference) ? metadata[reference]?.format : undefined);
  const name = isTexture(reference) ? reference : `${reference}.${typeof format === 'string' ? format : 'png'}`;
  const exact = assets.filter(asset => isTexture(asset.name) && basename(asset.name) === basename(name));
  if (exact.length === 1) return exact[0];
  if (exact.length) return null;
  // Extension-less ids may refer to a dropped JPEG/WebP instead of the original PNG.
  if (isTexture(reference)) return null;
  const stem = basename(reference);
  const matching = assets.filter(asset => isTexture(asset.name) && basename(asset.name).replace(/\.[^.]+$/, '') === stem);
  return matching.length === 1 ? matching[0] : null;
}


export const sidecarTextureSlots = { map: 'base_color_texture', alphaMap: 'alpha_texture', emissiveMap: 'emission_texture',
  normalMap: 'normal_texture', roughnessMap: 'roughness_texture', metalnessMap: 'metallic_texture', aoMap: 'ao_texture' };

export function referencedSidecarTextures(data, assets) {
  const found = new Set();
  for (const object of Object.values(data?.objects || {})) {
    if (!Array.isArray(object?.materials)) continue;
    for (const name of object.materials) {
      if (typeof name !== 'string' || !Object.hasOwn(data.materials || {}, name)) continue;
      const material = data.materials[name];
      for (const [slot, key] of Object.entries(sidecarTextureSlots)) {
        const reference = material?.impion?.parameters?.[slot] ?? material?.params?.[key];
        const asset = resolveSidecarTexture(reference, data.textures, assets);
        if (asset) found.add(asset);
      }
    }
  }
  return [...found];
}

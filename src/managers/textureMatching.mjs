import { basename } from '../../shared/sidecarTextures.mjs';
export { basename, isTexture, resolveSidecarTexture } from '../../shared/sidecarTextures.mjs';
export function textureInfo(name) {
  const stem = basename(name).replace(/\.[^.]+$/, '');
  const match = stem.match(/(?:^|[._ -])(base[._ -]?color|albedo|diffuse|color|normal|nrm|roughness|rough|metalness|metallic|metal|emissive|emission|ao|opacity|alpha|d|n|mg)$/i);
  const slots = { n: 'normalMap', mg: 'packedMetallicGloss', normal: 'normalMap', nrm: 'normalMap', roughness: 'roughnessMap', rough: 'roughnessMap', metalness: 'metalnessMap', metallic: 'metalnessMap', metal: 'metalnessMap', emissive: 'emissiveMap', emission: 'emissiveMap', ao: 'aoMap', opacity: 'alphaMap', alpha: 'alphaMap' };
  return { slot: slots[match?.[1]] || 'map', stem: (match ? stem.slice(0, match.index) : stem).replace(/[^a-z0-9]/g, '') };
}
export function matchResource(url, assets) {
  const candidates = assets.filter(asset => basename(asset.name) === basename(url));
  return candidates.length === 1 ? candidates[0].url : url;
}
export function chooseTexture(assets, materialName, meshName, slot, explicit) {
  const candidates = assets.filter(asset => textureInfo(asset.name).slot === slot);
  const names = [materialName, meshName].filter(Boolean).map(name => name.toLowerCase().replace(/[._ -](mat|material)$/, '').replace(/[^a-z0-9]/g, ''));
  const matching = candidates.filter(asset => names.includes(textureInfo(asset.name).stem));
  if (matching.length === 1) return matching[0];
  if (!matching.length && candidates.length === 1 && (explicit || slot === 'map')) return candidates[0];
  return null;
}


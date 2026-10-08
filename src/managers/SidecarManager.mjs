import { sidecarTextureSettings, applyTextureSettings } from './TextureSettings.mjs';
import { MeshStandardMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshBasicMaterial,
  FrontSide, BackSide, DoubleSide, NormalBlending, AdditiveBlending, SubtractiveBlending,
  MultiplyBlending, NoBlending, SRGBColorSpace, NoColorSpace, RepeatWrapping } from 'three';
import { TextureManager } from './TextureManager.mjs';
import { basename, resolveSidecarTexture } from './textureMatching.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => record(object) && Object.hasOwn(object, key) ? object[key] : undefined;
const normalize = name => name.replace(/[^\p{L}\p{N}_]/gu, '');
import { sidecarTextureSlots as slots } from '../../shared/sidecarTextures.mjs';
const sides = { FrontSide, BackSide, DoubleSide };
const blending = { NormalBlending, AdditiveBlending, SubtractiveBlending, MultiplyBlending, NoBlending };
const types = { Standard: MeshStandardMaterial, Physical: MeshStandardMaterial, Lambert: MeshLambertMaterial,
  Phong: MeshPhongMaterial, Basic: MeshBasicMaterial };

export function findSidecar(descriptor) {
  if (!['glb', 'gltf'].includes(descriptor.extension)) return null;
  const name = basename(descriptor.name).replace(/\.(glb|gltf)$/, '.json');
  const matches = (descriptor.assets || []).filter(asset => basename(asset.name) === name);
  return matches.length === 1 ? matches[0] : null;
}


function createMaterial(name, definition) {
  const impion = record(definition.impion) ? definition.impion : {};
  const params = record(definition.params) ? definition.params : {};
  const values = record(impion.parameters) ? impion.parameters : {};
  const Material = own(types, impion.materialType) || MeshStandardMaterial;
  const material = new Material(); material.name = name;
  material.userData.viewerSidecar = true; material.userData.viewerTextureRefs = {};
  const color = params.base_color;
  if (Array.isArray(color) && color.length >= 3 && color.slice(0, 3).every(Number.isFinite)) material.color.fromArray(color);
  if (Number.isFinite(params.alpha_value)) material.opacity = Math.max(0, Math.min(1, params.alpha_value));
  for (const key of ['opacity', 'alphaTest', 'metalness', 'roughness', 'emissiveIntensity', 'shininess']) {
    const value = values[key] ?? impion[key];
    if (key in material && Number.isFinite(value)) material[key] = value;
  }
  for (const key of ['depthWrite', 'depthTest', 'forceSinglePass', 'transparent', 'wireframe']) {
    const value = values[key] ?? impion[key];
    if (typeof value === 'boolean') material[key] = value;
  }
  material.side = own(sides, impion.side) ?? material.side;
  material.shadowSide = own(sides, impion.shadowSide) ?? null;
  material.blending = own(blending, impion.blending) ?? material.blending;
  if (values.transparent === undefined && impion.transparent === undefined) material.transparent = material.opacity < 1 || params.alpha_used === true;
  return material;
}

// Only the material/texture/object contract is interpreted. Blender nodes and scripts are not executed.
export async function applySidecar(root, data, assets, { parser, textures = new TextureManager() } = {}) {
  if (!record(data) || !record(data.materials) || !record(data.objects)) throw new Error('Expected materials and objects dictionaries');
  const warnings = new Set(), materials = new Map(), decoded = new Map(), replaced = new Set();
  const entries = Object.entries(data.objects).filter(([, value]) => record(value));
  const aliases = new Map();
  for (const [name, value] of entries) {
    const key = normalize(name);
    aliases.set(key, aliases.has(key) ? null : value);
  }
  const sourceName = object => {
    const index = parser?.associations.get(object)?.nodes;
    return parser?.json.nodes?.[index]?.name || object.name;
  };
  const lookup = object => {
    const name = sourceName(object);
    return own(data.objects, name) || aliases.get(normalize(name));
  };
  async function materialFor(name) {
    if (materials.has(name)) return materials.get(name);
    const definition = own(data.materials, name);
    if (!record(definition)) { warnings.add(`Unknown material: ${name}`); return null; }
    const material = createMaterial(name, definition);
    materials.set(name, material);
    for (const [slot, key] of Object.entries(slots)) {
      if (!(slot in material)) continue;
      const reference = definition.impion?.parameters?.[slot] ?? definition.params?.[key];
      if (typeof reference !== 'string' || !reference) continue;
      material.userData.viewerTextureRefs[slot] = reference;
      material.userData.viewerTextureSettings ||= {};
      const settings = sidecarTextureSettings(definition, reference, data.textures?.[reference], slot);
      material.userData.viewerTextureSettings[slot] = settings;
      const asset = resolveSidecarTexture(reference, data.textures, assets);
      if (!asset) { warnings.add(`Missing texture: ${reference}`); continue; }
      if (!decoded.has(asset)) {
        try { decoded.set(asset, await textures.decode(asset)); }
        catch { decoded.set(asset, null); warnings.add(`Unable to read texture: ${asset.name}`); }
      }
      const source = decoded.get(asset);
      if (!source) continue;
      const texture = source.clone();
      texture.flipY = false;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.colorSpace = ['map', 'emissiveMap'].includes(slot) ? SRGBColorSpace : NoColorSpace;
      applyTextureSettings(texture, settings);
      texture.needsUpdate = true; material[slot] = texture;
      if (slot === 'emissiveMap') material.emissive.set(0xffffff);
      if (slot === 'alphaMap' && material.alphaTest === 0) material.transparent = true;
    }
    return material;
  }
  const meshes = []; root.traverse(object => { if (object.isMesh) meshes.push(object); });
  let applied = 0;
  for (const mesh of meshes) {
    let owner = mesh, entry;
    while (owner && owner !== root.parent) { entry = lookup(owner); if (entry) break; owner = owner.parent; }
    if (!Array.isArray(entry?.materials) || !entry.materials.length || !entry.materials.every(name => typeof name === 'string')) continue;
    let names = entry.materials;
    if (names.length > 1) {
      const primitive = parser?.associations.get(mesh)?.primitives;
      if (Number.isInteger(primitive) && primitive < names.length) names = [names[primitive]];
      else if (!mesh.geometry.groups.length || mesh.geometry.groups.some(group => group.materialIndex >= names.length)) {
        warnings.add(`Ambiguous material slots: ${sourceName(owner)}`); continue;
      }
    }
    if (names.some(name => !record(own(data.materials, name)))) { warnings.add(`Unknown material on: ${sourceName(owner)}`); continue; }
    const assigned = [];
    for (const name of names) assigned.push(await materialFor(name));
    for (const material of [mesh.material].flat()) replaced.add(material);
    mesh.material = assigned.length === 1 ? assigned[0] : assigned;
    const flags = own(data.materials, names[0])?.impion;
    for (const key of ['castShadow', 'receiveShadow']) if (typeof flags?.[key] === 'boolean') mesh[key] = flags[key];
    if (!mesh.geometry.attributes.uv && assigned.some(material => Object.keys(slots).some(slot => material[slot]))) warnings.add(`No UV coordinates: ${mesh.name}`);
    applied++;
  }
  const retainedMaterials = new Set(), retainedTextures = new Set();
  root.traverse(object => { for (const material of [object.material].flat().filter(Boolean)) {
    retainedMaterials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) retainedTextures.add(value);
  } });
  const disposedTextures = new Set();
  for (const material of replaced) if (material && !retainedMaterials.has(material)) {
    for (const value of Object.values(material)) if (value?.isTexture && !retainedTextures.has(value)) disposedTextures.add(value);
    material.dispose();
  }
  for (const texture of disposedTextures) texture.dispose();
  for (const texture of decoded.values()) texture?.dispose();
  if (!applied) warnings.add('No matching objects in material JSON');
  return { applied, warnings: [...warnings] };
}

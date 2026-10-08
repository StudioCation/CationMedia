import { RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, LinearFilter, NearestFilter,
  LinearMipmapLinearFilter, SRGBColorSpace, NoColorSpace } from 'three';

const pair = value => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite);
const wraps = { REPEAT: RepeatWrapping, EXTEND: ClampToEdgeWrapping, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping };

// Read data only: follow the image's Vector input, never unrelated Mapping nodes.
export function sidecarTextureSettings(definition, reference, metadata = {}, slot = 'map') {
  const nodes = definition.nodes?.nodes || [], links = definition.nodes?.links || [];
  const images = nodes.filter(node => node.type === 'ShaderNodeTexImage' && node.image?.name === reference);
  const image = images.length === 1 ? images[0] : null;
  const settings = { flipY: false, wrapS: RepeatWrapping, wrapT: RepeatWrapping,
    colorSpace: ['map', 'emissiveMap'].includes(slot) && (image?.image?.colorspace ?? metadata.colorspace) !== 'Non-Color' ? SRGBColorSpace : NoColorSpace };
  const extension = image?.extension ?? image?.params?.extension;
  if (wraps[extension] !== undefined) settings.wrapS = settings.wrapT = wraps[extension];
  const interpolation = image?.interpolation ?? image?.params?.interpolation;
  if (interpolation === 'Closest') { settings.magFilter = NearestFilter; settings.minFilter = NearestFilter; }
  if (interpolation === 'Linear') { settings.magFilter = LinearFilter; settings.minFilter = LinearMipmapLinearFilter; }
  const input = image && links.find(link => link.to?.node === image.name && link.to.socket === 'Vector');
  const mapping = nodes.find(node => node.name === input?.from?.node && node.type === 'ShaderNodeMapping');
  if (mapping) {
    const params = mapping.params || {}, rotation = params.Rotation || [0, 0, 0];
    if (pair(params.Scale)) settings.repeat = params.Scale.slice(0, 2);
    if (pair(params.Location)) settings.offset = params.Location.slice(0, 2);
    // Blender UV is bottom-up; glTF UV is top-down. Conjugate the UV transform.
    const [sx, sy] = settings.repeat || [1, 1], [x, y] = settings.offset || [0, 0];
    const angle = Number.isFinite(rotation[2]) ? rotation[2] : 0;
    settings.rotation = angle;
    settings.offset = [x - Math.sin(angle) * sy, 1 - y - Math.cos(angle) * sy];
    if (angle && sx !== sy) settings.matrix = [Math.cos(angle) * sx, Math.sin(angle) * sy, settings.offset[0], -Math.sin(angle) * sx, Math.cos(angle) * sy, settings.offset[1], 0, 0, 1];
  }
  // Explicit texture metadata takes precedence over inferred Blender defaults.
  for (const key of ['repeat', 'offset', 'center']) if (pair(metadata[key])) settings[key] = metadata[key].slice(0, 2);
  for (const key of ['rotation', 'channel', 'anisotropy']) if (Number.isFinite(metadata[key])) settings[key] = metadata[key];
  for (const key of ['flipY', 'generateMipmaps']) if (typeof metadata[key] === 'boolean') settings[key] = metadata[key];
  for (const key of ['wrapS', 'wrapT']) if (wraps[metadata[key]] !== undefined) settings[key] = wraps[metadata[key]];
  return settings;
}

export function applyTextureSettings(texture, settings) {
  if (!settings) return;
  for (const key of ['repeat', 'offset', 'center']) if (pair(settings[key])) texture[key].fromArray(settings[key]);
  for (const key of ['flipY', 'wrapS', 'wrapT', 'rotation', 'channel', 'anisotropy', 'generateMipmaps', 'colorSpace', 'minFilter', 'magFilter']) if (settings[key] !== undefined) texture[key] = settings[key];
  if (settings.matrix) { texture.matrix.set(...settings.matrix); texture.matrixAutoUpdate = false; }
  else texture.updateMatrix();
  texture.needsUpdate = true;
}

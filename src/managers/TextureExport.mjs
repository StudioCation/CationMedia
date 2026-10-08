import { UnsignedByteType, FloatType, HalfFloatType, DataUtils } from 'three';
import { basename } from './textureMatching.mjs';
export const textureSlots = { map: 'Base color', normalMap: 'Normal', roughnessMap: 'Roughness', metalnessMap: 'Metallic', emissiveMap: 'Emission', aoMap: 'Ambient occlusion', alphaMap: 'Opacity', bumpMap: 'Bump', displacementMap: 'Displacement', lightMap: 'Light', specularMap: 'Specular', clearcoatMap: 'Clearcoat', clearcoatNormalMap: 'Clearcoat normal', clearcoatRoughnessMap: 'Clearcoat roughness' };
export function meshTextures(root, display) {
  const entries = new Map();
  root?.traverse(object => {
    if (!object.isMesh) return;
    for (const material of [display?.original.get(object) ?? object.material].flat().filter(Boolean)) for (const [slot, texture] of Object.entries(material)) {
      if (!texture?.isTexture || !texture.image) continue;
      const key = texture.source?.uuid || texture.uuid;
      if (!entries.has(key)) entries.set(key, { id: texture.uuid, name: texture.name || (texture.userData?.sourceURL && basename(texture.userData.sourceURL)) || `${material.name || object.name || 'material'}_${slot}`, texture });
    }
  });
  return [...entries.values()];
}
export async function textureCanvas(texture, maxSize = Infinity) {
  let readable = texture;
  if (texture.isCompressedTexture) { const { decompress } = await import('three/addons/utils/WebGLTextureUtils.js'); readable = decompress(texture, maxSize); }
  try {
    const image = readable.image;
    if (!image?.width || !image?.height || Array.isArray(image)) throw new Error('This texture has no exportable 2D image.');
    const canvas = document.createElement('canvas'), scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (image.data) {
      const channels = image.data.length / (image.width * image.height);
      if (![1, 2, 3, 4].includes(channels) || ![UnsignedByteType, FloatType, HalfFloatType].includes(readable.type)) throw new Error('Unsupported texture pixel format.');
      const pixels = new Uint8ClampedArray(image.width * image.height * 4);
      const value = n => readable.type === HalfFloatType ? DataUtils.fromHalfFloat(n) * 255 : readable.type === FloatType ? n * 255 : n;
      for (let i = 0; i < image.width * image.height; i++) {
        for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = value(image.data[i * channels + Math.min(channel, channels - 1)]);
        pixels[i * 4 + 3] = channels === 4 ? value(image.data[i * channels + 3]) : 255;
      }
      const full = document.createElement('canvas'); full.width = image.width; full.height = image.height;
      full.getContext('2d').putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
      context.drawImage(full, 0, 0, canvas.width, canvas.height);
    } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { if (readable !== texture) readable.dispose(); }
}
export async function encodeTexture(texture, format) {
  if (!['png', 'jpg', 'webp'].includes(format)) throw new Error('Unsupported texture format.');
  const canvas = await textureCanvas(texture);
  if (format === 'jpg') { const context = canvas.getContext('2d'); context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, `image/${format === 'jpg' ? 'jpeg' : format}`, 0.95));
  if (!blob) throw new Error('Unable to encode texture.');
  return new Uint8Array(await blob.arrayBuffer());
}

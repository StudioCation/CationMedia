import { detectMediaType } from './mediaTypes.mjs';

// A model with image-only drops keeps the existing texture-application behavior.
export function primaryDropFile(files, activeType) {
  const list = [...files];
  return list.find(file => {
    const id = detectMediaType(file.name)?.id;
    return id && id !== 'image';
  }) || (activeType === 'model3d' ? null : list.find(file => detectMediaType(file.name)?.id === 'image')) || null;
}

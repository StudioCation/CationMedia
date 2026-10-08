import {
  adjustImage, checkImage, cropImage, flipImage, removeColors,
  resizeImage, rotateImage, rotateImageByAngle, trimImage
} from './image.mjs';
import { autoCutout } from './imageSubject.mjs';
import { makeSeamlessTile } from './imageTile.mjs';

const adjustmentIds = new Set(['brightness', 'contrast', 'saturation', 'sharpness']);
const effectIds = new Set([
  'auto-cutout', 'remove-grid', ...adjustmentIds,
  'crop', 'flip-h', 'flip-v', 'loop-texture', 'remove-color', 'resize',
  'rotate', 'rotate-left', 'rotate-right', 'trim'
]);

function parameters(effect) {
  const value = effect.params === undefined ? {} : effect.params;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('params must be an object.');
  return value;
}

function applyOne(image, id, params) {
  if (id === 'auto-cutout' || id === 'remove-grid') return autoCutout(image);
  if (adjustmentIds.has(id)) {
    const value = params.value ?? 0;
    if (typeof value !== 'number') throw new Error('value must be a number.');
    return adjustImage(image, { [id]: value });
  }
  if (id === 'crop') {
    if (!params.rect || typeof params.rect !== 'object') throw new Error('rect is required.');
    return cropImage(image, params.rect);
  }
  if (id === 'flip-h') return flipImage(image, 'horizontal');
  if (id === 'flip-v') return flipImage(image, 'vertical');
  if (id === 'loop-texture') return makeSeamlessTile(image, { size: params.size ?? 512, blend: params.blend ?? 30 });
  if (id === 'remove-color') {
    const colors = params.colors ?? (params.color === undefined ? undefined : [params.color]);
    return removeColors(image, colors, params.tolerance ?? 24, params.softness ?? 16);
  }
  if (id === 'resize') return resizeImage(image, params.width, params.height);
  if (id === 'rotate') return rotateImageByAngle(image, params.angle ?? 0);
  if (id === 'rotate-left') return rotateImage(image, 'ccw');
  if (id === 'rotate-right') return rotateImage(image, 'cw');
  if (id === 'trim') return trimImage(image, params.threshold ?? 0);
  throw new Error(`Unknown image effect "${id}".`);
}

/**
 * Replay an ordered list of editable effects against an unchanged source image.
 *
 * Each item is { id, enabled?: boolean, params?: object }. Missing enabled means
 * true. Adjustments use params.value; crop uses params.rect; resize uses
 * params.width/height; remove-color uses params.colors (RGB triplets) or
 * params.color (one RGB triplet), with optional tolerance/softness. Trim uses
 * params.threshold. Loop texture uses params.size and params.blend. Rotate uses
 * params.angle in degrees, from -180 to 180. Disabled
 * effects are skipped without evaluating params.
 * The returned { width, height, data } and its pixel buffer are always new.
 */
export function applyImageEffects(original, effects) {
  checkImage(original);
  if (!Array.isArray(effects)) throw new Error('Image effects must be an array.');
  let image = { width: original.width, height: original.height, data: original.data.slice() };
  for (const [index, effect] of effects.entries()) {
    if (!effect || typeof effect !== 'object' || Array.isArray(effect) || typeof effect.id !== 'string') {
      throw new Error(`Invalid image effect at index ${index}.`);
    }
    const { id, enabled = true } = effect;
    if (!effectIds.has(id)) throw new Error(`Unknown image effect "${id}" at index ${index}.`);
    if (typeof enabled !== 'boolean') throw new Error(`Image effect "${id}" enabled must be a boolean.`);
    if (!enabled) continue;
    try {
      image = applyOne(image, id, parameters(effect));
    } catch (error) {
      throw new Error(`Image effect "${id}" failed: ${error.message}`, { cause: error });
    }
  }
  // trimImage includes offsets for standalone callers; replay output is only
  // the image contract, so no transient trim metadata leaks into later steps.
  return { width: image.width, height: image.height, data: image.data };
}

export const imageExtensions = Object.freeze(['jpg', 'jpeg', 'tif', 'tiff', 'png', 'gif', 'webp', 'bmp']);
export const imageExportFormats = Object.freeze(['png', 'jpg', 'webp', 'bmp', 'tiff', 'gif']);
export const imageExtension = name => {
  const value = String(name || '');
  return value.includes('.') ? value.slice(value.lastIndexOf('.') + 1).toLowerCase() : '';
};
export const isImage = name => imageExtensions.includes(imageExtension(name));

const byte = value => Math.max(0, Math.min(255, Math.round(value)));
const integer = (value, label) => {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid ' + label + '.');
  return value;
};
export function checkImage(image) {
  const width = integer(image?.width, 'image width'), height = integer(image?.height, 'image height');
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64_000_000) throw new Error('Image exceeds the supported canvas size.');
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length !== width * height * 4) throw new Error('Invalid image pixels.');
  return image;
}
const output = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64_000_000) throw new Error('Image exceeds the supported canvas size.');
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
};
const copyPixel = (src, si, dest, di) => { for (let c = 0; c < 4; c++) dest[di + c] = src[si + c]; };

export function cropImage(image, rect) {
  checkImage(image);
  const x = integer(rect.x, 'crop x'), y = integer(rect.y, 'crop y');
  const width = integer(rect.width, 'crop width'), height = integer(rect.height, 'crop height');
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > image.width || y + height > image.height) throw new Error('Crop must fit inside the image.');
  const result = output(width, height);
  for (let row = 0; row < height; row++) result.data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4);
  return result;
}
export function flipImage(image, axis) {
  checkImage(image);
  if (!['horizontal', 'vertical'].includes(axis)) throw new Error('Invalid mirror axis.');
  const result = output(image.width, image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const sx = axis === 'horizontal' ? image.width - 1 - x : x;
    const sy = axis === 'vertical' ? image.height - 1 - y : y;
    copyPixel(image.data, (sy * image.width + sx) * 4, result.data, (y * image.width + x) * 4);
  }
  return result;
}
export function rotateImage(image, direction) {
  checkImage(image);
  if (direction !== 'cw' && direction !== 'ccw') throw new Error('Invalid rotation.');
  const result = output(image.height, image.width);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
    const sx = direction === 'cw' ? y : image.width - 1 - y;
    const sy = direction === 'cw' ? image.height - 1 - x : x;
    copyPixel(image.data, (sy * image.width + sx) * 4, result.data, (y * result.width + x) * 4);
  }
  return result;
}
export function rotateImageByAngle(image, angle) {
  checkImage(image);
  if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < -180 || angle > 180) throw new Error('Invalid rotation angle.');
  if (angle === 0) return { width: image.width, height: image.height, data: image.data.slice() };
  if (angle === 90) return rotateImage(image, 'cw');
  if (angle === -90) return rotateImage(image, 'ccw');
  if (Math.abs(angle) === 180) {
    const result = output(image.width, image.height);
    for (let index = 0, count = image.width * image.height; index < count; index++) {
      copyPixel(image.data, index * 4, result.data, (count - index - 1) * 4);
    }
    return result;
  }
  const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const width = Math.ceil(Math.abs(image.width * cosine) + Math.abs(image.height * sine));
  const height = Math.ceil(Math.abs(image.width * sine) + Math.abs(image.height * cosine));
  const result = output(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - width / 2, dy = y + .5 - height / 2;
    const sx = cosine * dx + sine * dy + image.width / 2 - .5;
    const sy = -sine * dx + cosine * dy + image.height / 2 - .5;
    if (sx <= -1 || sy <= -1 || sx >= image.width || sy >= image.height) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const samples = [
      [x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]
    ];
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (const [px, py, weight] of samples) {
      if (px < 0 || py < 0 || px >= image.width || py >= image.height || weight <= 0) continue;
      const at = (py * image.width + px) * 4, contribution = weight * image.data[at + 3];
      alpha += contribution;
      red += contribution * image.data[at];
      green += contribution * image.data[at + 1];
      blue += contribution * image.data[at + 2];
    }
    const at = (y * width + x) * 4;
    result.data[at + 3] = byte(alpha);
    if (result.data[at + 3]) {
      result.data[at] = byte(red / alpha);
      result.data[at + 1] = byte(green / alpha);
      result.data[at + 2] = byte(blue / alpha);
    }
  }
  return result;
}
export function resizeImage(image, width, height) {
  checkImage(image);
  const result = output(integer(width, 'resize width'), integer(height, 'resize height'));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.max(0, Math.min(image.width - 1, (x + .5) * image.width / width - .5));
    const sy = Math.max(0, Math.min(image.height - 1, (y + .5) * image.height / height - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
    const fx = sx - x0, fy = sy - y0, weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    const indices = [(y0 * image.width + x0) * 4, (y0 * image.width + x1) * 4, (y1 * image.width + x0) * 4, (y1 * image.width + x1) * 4];
    const di = (y * width + x) * 4;
    let alpha = 0;
    for (let i = 0; i < 4; i++) alpha += weights[i] * image.data[indices[i] + 3];
    result.data[di + 3] = byte(alpha);
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = 0; i < 4; i++) sum += weights[i] * image.data[indices[i] + c] * image.data[indices[i] + 3];
      result.data[di + c] = alpha ? byte(sum / alpha) : 0;
    }
  }
  return result;
}
export function adjustImage(image, values = {}) {
  checkImage(image);
  const brightness = Number(values.brightness || 0), contrast = Number(values.contrast || 0);
  const saturation = Number(values.saturation || 0), sharpness = Number(values.sharpness || 0);
  if ([brightness, contrast, saturation, sharpness].some(value => !Number.isFinite(value) || value < -100 || value > 100) || sharpness < 0) throw new Error('Invalid adjustment.');
  const result = output(image.width, image.height), factor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  for (let i = 0; i < image.data.length; i += 4) {
    const rgb = [0, 1, 2].map(c => byte(factor * (image.data[i + c] - 128) + 128 + brightness * 2.55));
    const gray = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    for (let c = 0; c < 3; c++) result.data[i + c] = byte(gray + (rgb[c] - gray) * (1 + saturation / 100));
    result.data[i + 3] = image.data[i + 3];
  }
  if (!sharpness) return result;
  const original = result.data.slice(), strength = sharpness / 50;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const at = (y * image.width + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy;
        if (px >= 0 && px < image.width && py >= 0 && py < image.height) { sum += original[(py * image.width + px) * 4 + c]; count++; }
      }
      result.data[at + c] = byte(original[at + c] + strength * (original[at + c] - sum / count));
    }
  }
  return result;
}
export function removeColors(image, colors, tolerance = 24, softness = 16) {
  checkImage(image);
  if (!Array.isArray(colors) || !colors.length || colors.some(color => !Array.isArray(color) || color.length !== 3 || color.some(value => !Number.isInteger(value) || value < 0 || value > 255))) throw new Error('Choose a valid background color.');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 441 || !Number.isFinite(softness) || softness < 0 || softness > 441) throw new Error('Invalid background tolerance.');
  const result = output(image.width, image.height); result.data.set(image.data);
  for (let i = 0; i < result.data.length; i += 4) {
    const distance = Math.min(...colors.map(color => Math.hypot(result.data[i] - color[0], result.data[i + 1] - color[1], result.data[i + 2] - color[2])));
    const keep = softness ? Math.max(0, Math.min(1, (distance - tolerance) / softness)) : Number(distance > tolerance);
    result.data[i + 3] = byte(result.data[i + 3] * keep);
  }
  return result;
}
export function trimImage(image, threshold = 0) {
  checkImage(image);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 254) throw new Error('Invalid alpha threshold.');
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] <= threshold) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) return { ...output(1, 1), offsetX: 0, offsetY: 0 };
  return { ...cropImage(image, { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }), offsetX: left, offsetY: top };
}
export function alphaMask(image, mode = 'both') {
  checkImage(image);
  if (!['full', 'partial', 'both'].includes(mode)) throw new Error('Invalid alpha mask.');
  const result = output(image.width, image.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    if (alpha === 0 && mode !== 'partial') {
      // Keep empty pixels distinct from the blue-to-white partial-alpha scale.
      result.data[i] = 255;
      result.data[i + 1] = 50;
      result.data[i + 2] = 110;
      result.data[i + 3] = 224;
    } else if (alpha > 0 && alpha < 255 && mode !== 'full') {
      // An opaque diagnostic overlay keeps even alpha=1 visible. Its increasing
      // brightness makes the amount of coverage visible instead of marking every
      // partially transparent pixel with the same faint color.
      const coverage = alpha / 254;
      result.data[i] = 32 + Math.round(184 * coverage);
      result.data[i + 1] = 88 + Math.round(156 * coverage);
      result.data[i + 2] = 240 + Math.round(15 * coverage);
      result.data[i + 3] = 255;
    }
  }
  return result;
}
export function packAtlas(items, { mode = 'auto', maxWidth = 2048, maxHeight = 2048, padding = 2, autoSize = false } = {}) {
  if (!Array.isArray(items) || !items.length || !['auto', 'grid'].includes(mode)) throw new Error('Select images for the atlas.');
  if (autoSize) { maxWidth = 16384; maxHeight = 16384; }
  for (const [value, label] of [[maxWidth, 'atlas width'], [maxHeight, 'atlas height'], [padding, 'atlas padding']]) integer(value, label);
  if (maxWidth < 1 || maxHeight < 1 || maxWidth > 16384 || maxHeight > 16384 || padding < 0 || padding > 256) throw new Error('Invalid atlas limits.');
  const sprites = items.map((item, index) => {
    const width = integer(item.width, 'sprite width'), height = integer(item.height, 'sprite height');
    if (width < 1 || height < 1 || width > maxWidth || height > maxHeight) throw new Error('A sprite exceeds the atlas limits.');
    return { id: String(item.id ?? index), width, height, index };
  });
  if (new Set(sprites.map(item => item.id)).size !== sprites.length) throw new Error('Atlas image names must be unique.');
  const better = (candidate, best) => {
    if (!best) return true;
    const span = Math.max(candidate.width, candidate.height), bestSpan = Math.max(best.width, best.height);
    if (autoSize && span !== bestSpan) return span < bestSpan;
    return candidate.width * candidate.height < best.width * best.height || (candidate.width * candidate.height === best.width * best.height && candidate.width < best.width);
  };
  if (mode === 'grid') {
    const cellW = Math.max(...sprites.map(item => item.width)), cellH = Math.max(...sprites.map(item => item.height));
    const columns = Math.min(sprites.length, Math.floor((maxWidth + padding) / (cellW + padding)));
    if (!columns) throw new Error('Atlas width is too small.');
    let best = null;
    for (let count = autoSize ? 1 : columns; count <= columns; count++) {
      const rows = Math.ceil(sprites.length / count), width = count * cellW + (count - 1) * padding, height = rows * cellH + (rows - 1) * padding;
      if (height > maxHeight || width * height > 64_000_000) continue;
      const candidate = { width, height, columns: count };
      if (better(candidate, best)) best = candidate;
    }
    if (!best) throw new Error('Images do not fit inside the atlas limits.');
    return { width: best.width, height: best.height, placements: sprites.map((item, index) => ({ ...item, x: index % best.columns * (cellW + padding), y: Math.floor(index / best.columns) * (cellH + padding) })) };
  }
  const sorted = [...sprites].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || b.width * b.height - a.width * a.height || a.id.localeCompare(b.id));
  const minWidth = Math.max(...sorted.map(item => item.width));
  let best = null;
  const widths = new Set([minWidth, maxWidth]);
  for (let width = Math.ceil(minWidth / 64) * 64; width < maxWidth; width += 64) widths.add(width);
  for (const width of [...widths].sort((a, b) => a - b)) {
    let x = 0, y = 0, shelfH = 0, usedW = 0;
    const placements = [];
    for (const item of sorted) {
      if (x && x + item.width > width) { y += shelfH + padding; x = 0; shelfH = 0; }
      if (y + item.height > maxHeight) break;
      placements.push({ ...item, x, y }); usedW = Math.max(usedW, x + item.width); shelfH = Math.max(shelfH, item.height); x += item.width + padding;
    }
    if (placements.length !== sorted.length || usedW * (y + shelfH) > 64_000_000) continue;
    const height = y + shelfH, candidate = { width: usedW, height, placements: placements.sort((a, b) => a.index - b.index) };
    if (better(candidate, best)) best = candidate;
  }
  if (!best) throw new Error('Images do not fit inside the atlas limits.');
  return best;
}

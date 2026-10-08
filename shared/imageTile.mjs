import { checkImage, cropImage, resizeImage } from './image.mjs';

const smoothstep = value => value * value * (3 - 2 * value);

function averagePixel(data, first, second) {
  const a = data[first + 3], b = data[second + 3];
  return [0, 1, 2].map(channel => a + b
    ? (data[first + channel] * a + data[second + channel] * b) / (a + b)
    : 0).concat((a + b) / 2);
}

/** Make a square, power-of-two texture whose left/right and top/bottom borders repeat smoothly. */
export function makeSeamlessTile(image, { size = 512, blend = 30 } = {}) {
  checkImage(image);
  if (!Number.isInteger(size) || size < 128 || size > 4096 || (size & (size - 1))) throw new Error('Tile size must be a power of two from 128 to 4096.');
  if (!Number.isInteger(blend) || blend < 5 || blend > 50) throw new Error('Blend width must be from 5% to 50%.');

  const square = Math.min(image.width, image.height);
  const crop = image.width === image.height ? image : cropImage(image, {
    x: Math.floor((image.width - square) / 2),
    y: Math.floor((image.height - square) / 2),
    width: square,
    height: square
  });
  const source = crop.width === size ? crop : resizeImage(crop, size, size);
  const data = new Uint8ClampedArray(source.data.length);
  const half = size / 2, rowBytes = size * 4, wrap = size - 1;
  const feather = Math.max(1, Math.round(size * blend / 200));
  const mask = new Float32Array(size);
  for (let coordinate = 0; coordinate < size; coordinate++) {
    mask[coordinate] = smoothstep(Math.min(1, Math.min(coordinate, size - 1 - coordinate) / feather));
  }

  // Repeat the image shifted by half a tile to the left and right, then lay
  // the original over its central seam with a horizontal gradient mask. Do
  // the same vertically. The four samples below are the two passes combined
  // into one read from the unchanged source, so no pixels are stretched.
  for (let y = 0; y < size; y++) {
    const originalRow = y * rowBytes, shiftedRow = ((y + half) & wrap) * rowBytes;
    const vertical = mask[y], shiftedVertical = 1 - vertical;
    for (let x = 0; x < size; x++) {
      const originalColumn = x * 4, shiftedColumn = ((x + half) & wrap) * 4;
      const horizontal = mask[x], shiftedHorizontal = 1 - horizontal;
      const original = originalRow + originalColumn, shiftedX = originalRow + shiftedColumn;
      const shiftedY = shiftedRow + originalColumn, shiftedBoth = shiftedRow + shiftedColumn;
      const ownWeight = vertical * horizontal, xWeight = vertical * shiftedHorizontal;
      const yWeight = shiftedVertical * horizontal, bothWeight = shiftedVertical * shiftedHorizontal;
      const ownAlpha = source.data[original + 3] * ownWeight;
      const xAlpha = source.data[shiftedX + 3] * xWeight;
      const yAlpha = source.data[shiftedY + 3] * yWeight;
      const bothAlpha = source.data[shiftedBoth + 3] * bothWeight;
      const target = originalRow + originalColumn;
      const alpha = ownAlpha + xAlpha + yAlpha + bothAlpha;
      for (let channel = 0; channel < 3; channel++) {
        data[target + channel] = alpha ? (
          source.data[original + channel] * ownAlpha + source.data[shiftedX + channel] * xAlpha +
          source.data[shiftedY + channel] * yAlpha + source.data[shiftedBoth + channel] * bothAlpha
        ) / alpha : 0;
      }
      data[target + 3] = alpha;
    }
  }

  // The half-shift makes neighbouring tiles meet at adjacent pixels of the
  // source. Match only the outermost pixels to close a possible sharp feature
  // there, without blurring strips of texture along either border.
  for (let y = 0; y < size; y++) {
    const row = y * rowBytes;
    const edge = averagePixel(data, row, row + (size - 1) * 4);
    for (let channel = 0; channel < 4; channel++) {
      data[row + channel] = edge[channel];
      data[row + (size - 1) * 4 + channel] = edge[channel];
    }
  }
  for (let x = 0; x < size; x++) {
    const column = x * 4;
    const edge = averagePixel(data, column, (size - 1) * rowBytes + column);
    for (let channel = 0; channel < 4; channel++) {
      data[column + channel] = edge[channel];
      data[(size - 1) * rowBytes + column + channel] = edge[channel];
    }
  }

  return { width: size, height: size, data };
}

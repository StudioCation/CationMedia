export function moveCrop(crop, handle, dx, dy, width, height) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
  let x = crop.left, y = crop.top, right = width - crop.right, bottom = height - crop.bottom;
  if (handle === 'move') {
    const w = right - x, h = bottom - y;
    x = clamp(x + dx, 0, width - w); y = clamp(y + dy, 0, height - h); right = x + w; bottom = y + h;
  } else {
    if (handle.includes('w')) x = clamp(x + dx, 0, right - 2);
    if (handle.includes('e')) right = clamp(right + dx, x + 2, width);
    if (handle.includes('n')) y = clamp(y + dy, 0, bottom - 2);
    if (handle.includes('s')) bottom = clamp(bottom + dy, y + 2, height);
  }
  return { left: x, top: y, right: width - right, bottom: height - bottom };
}

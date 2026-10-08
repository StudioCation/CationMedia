// The middle mouse button pans both audio surfaces without taking over primary clicks.
export function bindMiddlePan(element, pan) {
  let pointer = null;
  const finish = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer = null;
    element.classList.remove('is-panning');
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };
  const down = event => {
    if (event.button !== 1) return;
    event.preventDefault(); event.stopPropagation();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    element.setPointerCapture(event.pointerId);
    element.classList.add('is-panning');
  };
  const move = event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    event.preventDefault();
    const dx = pointer.x - event.clientX, dy = pointer.y - event.clientY;
    pointer.x = event.clientX; pointer.y = event.clientY;
    pan(dx, dy);
  };
  const auxclick = event => { if (event.button === 1) event.preventDefault(); };
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  element.addEventListener('auxclick', auxclick);
  return () => {
    for (const [type, listener] of [['pointerdown', down], ['pointermove', move], ['pointerup', finish], ['pointercancel', finish], ['lostpointercapture', finish], ['auxclick', auxclick]]) element.removeEventListener(type, listener);
    element.classList.remove('is-panning');
  };
}

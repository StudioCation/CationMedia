import assert from 'node:assert/strict';
import test from 'node:test';
import { bindMiddlePan } from '../src/components/MiddlePan.mjs';

test('middle drag pans in both directions without taking primary clicks', () => {
  const element = new EventTarget(), classes = new Set(), movement = [];
  element.classList = { add: value => classes.add(value), remove: value => classes.delete(value) };
  element.setPointerCapture = id => { element.captured = id; };
  element.hasPointerCapture = id => element.captured === id;
  element.releasePointerCapture = id => { if (element.captured === id) element.captured = null; };
  const fire = (type, fields) => {
    const event = new Event(type, { cancelable: true }); Object.assign(event, fields); element.dispatchEvent(event); return event;
  };
  const unbind = bindMiddlePan(element, (dx, dy) => movement.push([dx, dy]));
  fire('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 80 });
  fire('pointermove', { pointerId: 1, clientX: 70, clientY: 60 });
  assert.deepEqual(movement, []);
  const middle = fire('pointerdown', { button: 1, pointerId: 2, clientX: 100, clientY: 80 });
  assert.equal(middle.defaultPrevented, true); assert.ok(classes.has('is-panning'));
  fire('pointermove', { pointerId: 2, clientX: 70, clientY: 60 });
  assert.deepEqual(movement, [[30, 20]]);
  assert.equal(fire('auxclick', { button: 1 }).defaultPrevented, true);
  fire('pointerup', { pointerId: 2 });
  assert.equal(element.captured, null); assert.equal(classes.has('is-panning'), false);
  unbind();
});

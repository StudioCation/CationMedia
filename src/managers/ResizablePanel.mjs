// Shared pointer/keyboard resizing and persistence for media editor panels.
export class ResizablePanel {
  constructor({ handle, panel, key, axis, initial, limits, changed = () => {} }) {
    Object.assign(this, { handle, panel, key: `cation-media.panel.${key}`, axis, initial, limits, changed });
    this.controller = new AbortController(); const options = { signal: this.controller.signal };
    let saved; try { saved = Number(localStorage.getItem(this.key)); } catch {}
    this.value = saved > 0 ? saved : initial;
    const position = e => axis === 'x' ? e.clientX : e.clientY;
    handle.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); handle.setPointerCapture(e.pointerId); this.drag = { at: position(e), value: this.value }; document.body.classList.add('resizing'); }, options);
    handle.addEventListener('pointermove', e => { if (this.drag) this.set(this.drag.value + this.drag.at - position(e)); }, options);
    const finish = () => { if (!this.drag) return; this.drag = null; document.body.classList.remove('resizing'); this.save(); };
    handle.addEventListener('pointerup', finish, options); handle.addEventListener('lostpointercapture', finish, options);
    handle.addEventListener('pointercancel', () => { if (this.drag) this.set(this.drag.value); finish(); }, options);
    handle.addEventListener('dblclick', () => { this.set(initial); this.save(); }, options);
    handle.addEventListener('keydown', e => {
      const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      if (![...keys, 'Home'].includes(e.key)) return;
      e.preventDefault(); this.set(e.key === 'Home' ? initial : this.value + (e.key === keys[0] ? 12 : -12)); this.save();
    }, options);
    this.observer = new ResizeObserver(() => this.set(this.value)); this.observer.observe(panel.parentElement);
    this.set(this.value);
  }
  set(value) {
    if (!this.panel.parentElement.clientWidth || !this.panel.parentElement.clientHeight) return;
    const [min, max] = this.limits(); this.value = Math.max(min, Math.min(max, value));
    this.panel.style[this.axis === 'x' ? 'width' : 'height'] = `${this.value}px`;
    for (const [name, number] of Object.entries({ min, max, now: this.value })) this.handle.setAttribute(`aria-value${name}`, String(Math.round(number)));
    this.changed(this.value);
  }
  save() { try { localStorage.setItem(this.key, String(this.value)); } catch {} }
  dispose() { this.controller.abort(); this.observer.disconnect(); document.body.classList.remove('resizing'); }
}

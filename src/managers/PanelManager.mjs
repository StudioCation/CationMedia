const storageKey = 'cation-viewer.panels';
export class PanelManager {
  constructor(host) {
    this.host = host;
    try { this.sizes = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { this.sizes = {}; }
    this.apply();
    for (const handle of host.querySelectorAll('[data-resize]')) {
      const key = handle.dataset.resize;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); handle.setPointerCapture(event.pointerId);
        this.drag = { key, x: event.clientX, y: event.clientY, value: this.sizes[key] };
        document.body.classList.add('resizing');
      });
      handle.addEventListener('pointermove', event => {
        if (this.drag?.key !== key) return;
        const delta = (event.clientX - this.drag.x) * (key === 'right' ? -1 : 1);
        this.sizes[key] = this.drag.value + delta; this.apply();
      });
      const stop = () => { this.drag = null; document.body.classList.remove('resizing'); this.save(); };
      handle.addEventListener('pointerup', stop); handle.addEventListener('lostpointercapture', stop);
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') this.sizes[key] = { left: 230, right: 238 }[key];
        else this.sizes[key] += (['ArrowRight', 'ArrowUp'].includes(event.key) ? 12 : -12) * (key === 'right' ? -1 : 1);
        this.apply(); this.save();
      });
    }
    this.resize = () => this.apply(); window.addEventListener('resize', this.resize);
  }
  apply() {
    const maxSide = Math.max(160, Math.min(480, (window.innerWidth - 320) / 2));
    for (const [key, fallback] of Object.entries({ left: 230, right: 238 })) {
      const value = Number.isFinite(this.sizes[key]) ? this.sizes[key] : fallback;
      this.sizes[key] = Math.max(160, Math.min(maxSide, value));
      this.host.style.setProperty(`--${key}-size`, `${this.sizes[key]}px`);
      for (const handle of this.host.querySelectorAll(`[data-resize="${key}"]`)) {
        handle.setAttribute('aria-valuemin', String(160));
        handle.setAttribute('aria-valuemax', String(Math.round(maxSide)));
        handle.setAttribute('aria-valuenow', String(Math.round(this.sizes[key])));
      }
    }
  }
  save() { try { localStorage.setItem(storageKey, JSON.stringify(this.sizes)); } catch {} }
  dispose() { window.removeEventListener('resize', this.resize); }
}

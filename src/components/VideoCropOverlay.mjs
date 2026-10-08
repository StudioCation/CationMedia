import { moveCrop } from '../../shared/videoCrop.mjs';

export class VideoCropOverlay {
  constructor(host, { info, get, set }) {
    Object.assign(this, { host, info, get, set });
    host.innerHTML = `<div class="video-crop-box" data-handle="move" tabindex="0" role="group" aria-label="Move crop frame"><span class="crop-grid" aria-hidden="true"></span>${[['nw', 'top left'], ['n', 'top'], ['ne', 'top right'], ['e', 'right'], ['se', 'bottom right'], ['s', 'bottom'], ['sw', 'bottom left'], ['w', 'left']].map(([key, label]) => `<button type="button" data-handle="${key}" title="Resize crop ${label}" aria-label="Resize crop ${label}"></button>`).join('')}<output class="crop-dimensions"></output></div>`;
    this.box = host.firstElementChild;
    host.onpointerdown = e => {
      const handle = e.target.closest('[data-handle]'); if (!handle || e.button !== 0) return;
      e.preventDefault(); handle.focus(); host.setPointerCapture(e.pointerId);
      this.drag = { crop: this.get(), handle: handle.dataset.handle, x: e.clientX, y: e.clientY, rect: host.getBoundingClientRect() };
    };
    host.onpointermove = e => {
      if (!this.drag) return; const d = this.drag, i = this.info();
      this.set(moveCrop(d.crop, d.handle, (e.clientX - d.x) * i.width / d.rect.width, (e.clientY - d.y) * i.height / d.rect.height, i.width, i.height));
    };
    host.onpointerup = () => { this.drag = null; };
    host.onpointercancel = () => { if (this.drag) this.set(this.drag.crop); this.drag = null; };
    host.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const handle = e.target.closest('[data-handle]'); if (!handle) return;
      e.preventDefault(); e.stopPropagation(); const step = e.shiftKey ? 10 : 1, i = this.info();
      this.set(moveCrop(this.get(), handle.dataset.handle, ({ ArrowLeft: -step, ArrowRight: step }[e.key] || 0), ({ ArrowUp: -step, ArrowDown: step }[e.key] || 0), i.width, i.height));
    };
  }
  draw() {
    const c = this.get(), i = this.info();
    Object.assign(this.box.style, { left: `${c.left / i.width * 100}%`, top: `${c.top / i.height * 100}%`, right: `${c.right / i.width * 100}%`, bottom: `${c.bottom / i.height * 100}%` });
    this.box.querySelector('output').textContent = `${i.width - c.left - c.right} × ${i.height - c.top - c.bottom}`;
  }
}

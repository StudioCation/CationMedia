import { icons } from './Icons.mjs';
// Shared controls for media inspectors and viewport toolbars.
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function toolIcon(name) {
  if (!icons[name]) throw new Error(`Unknown icon: ${name}`);
  return icons[name].replace('<svg', '<svg aria-hidden="true" focusable="false"');
}
export function toolButton({ id, label, icon, attributes = '' }) { return `<button${id ? ` id="${escape(id)}"` : ''} title="${escape(label)}" aria-label="${escape(label)}" ${attributes}>${toolIcon(icon)}</button>`; }
export function inspectorField(parent, label, input) {
  const row = document.createElement('label'); row.className = 'inspector-field';
  const text = document.createElement('span'); text.textContent = label; row.append(text, input); parent.append(row);
  input.setAttribute('aria-label', label); return input;
}
export function numberFieldMarkup(id, label, min, max, value, step = 1) {
  return `<label class="inspector-field"><span>${escape(label)}</span><input id="${escape(id)}" aria-label="${escape(label)}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}
export function panelDivider(side, label) { return `<div class="resize-handle vertical" data-resize="${escape(side)}" role="separator" aria-label="${escape(label)}" aria-orientation="vertical" tabindex="0"></div>`; }
export function sliderFieldMarkup(id, label, min, max, value, step = 1, attributes = '') {
  return `<div class="inspector-slider"><label class="inspector-field" for="${escape(id)}"><span>${escape(label)}</span><input id="${escape(id)}" aria-label="${escape(label)}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" required ${attributes}></label><input type="range" data-slider-for="${escape(id)}" aria-label="${escape(label)} slider" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}
export function bindSliderFields(host) {
  const sliders = [...host.querySelectorAll('[data-slider-for]')];
  const refresh = (slider, input) => {
    const logarithmic = input.dataset.sliderScale === 'log';
    slider.min = logarithmic ? 0 : input.min; slider.max = logarithmic ? 1000 : input.max; slider.step = logarithmic ? 1 : input.dataset.sliderStep || input.step;
    slider.value = logarithmic ? Math.log(Math.max(Number(input.min), Number(input.value)) / Number(input.min)) / Math.log(Number(input.max) / Number(input.min)) * 1000 : input.value;
    slider.disabled = input.disabled;
    slider.style.setProperty('--range-fill', `${(Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min)) * 100}%`);
    slider.setAttribute('aria-valuetext', input.value);
  };
  for (const slider of sliders) {
    const input = host.querySelector(`#${slider.dataset.sliderFor}`);
    slider.addEventListener('input', event => {
      event.stopPropagation();
      const value = input.dataset.sliderScale === 'log' ? Number(input.min) * (Number(input.max) / Number(input.min)) ** (Number(slider.value) / 1000) : Number(slider.value);
      input.value = Math.max(Number(input.min), Math.min(Number(input.max), Math.round(value / Number(input.step)) * Number(input.step)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('input', () => { if (input.validity.valid) refresh(slider, input); });
    refresh(slider, input);
  }
  return () => { for (const slider of sliders) refresh(slider, host.querySelector(`#${slider.dataset.sliderFor}`)); };
}

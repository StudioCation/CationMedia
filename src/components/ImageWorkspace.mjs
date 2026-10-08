import { imageExtension, isImage, imageExportFormats, checkImage, alphaMask, packAtlas } from '../../shared/image.mjs';
import { applyImageEffects } from '../../shared/imageEffects.mjs';
import { imageToolDefinitions, imageUiIcons, imageIcon } from './ImageTools.mjs';

const hex = value => [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
const dataCanvas = pixels => {
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height;
  canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return canvas;
};
const readImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Image decoding failed.'));
  image.src = source;
});
function pixelsOf(image) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (width < 1 || height < 1 || width * height > 64_000_000 || width > 16384 || height > 16384) throw new Error('Image exceeds the supported canvas size.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const result = context.getImageData(0, 0, width, height);
  return checkImage({ width, height, data: result.data });
}
async function staticPixels(source, extension) {
  const image = await readImage(source);
  if (extension === 'gif' && globalThis.createImageBitmap) {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    try { return pixelsOf(bitmap); } finally { bitmap.close(); }
  }
  return pixelsOf(image);
}
const labelSize = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

export class ImageWorkspace {
  constructor(host, { message, open, changed } = {}) {
    this.host = host; this.message = message || (() => {}); this.open = open || (() => {}); this.changed = changed || (() => {});
    this.mode = 'viewer'; this.zoom = 'fit'; this.tool = 'auto-cutout'; this.history = []; this.historyLabels = []; this.historyEffects = []; this.effects = []; this.previewPixels = null; this.index = -1; this.savedIndex = -1;
    this.browser = null; this.documentBrowser = null; this.selection = new Set(); this.maskMode = 'off'; this.crop = null; this.cropping = false; this.pickColor = false;
    this.atlasMode = false; this.atlas = null; this.documentId = null; this.sessionId = null; this.name = ''; this.animated = false;
    this.loopPreviewPixels = null; this.loopPreviewPending = null; this.loopPreviewUrl = null; this.loopPreviewRevision = 0;
    this.treeCache = new Map(); this.treeExpanded = new Set(['desktop-root', 'computer']); this.treeNodes = new Map(); this.treeRevision = 0; this.locations = [];
    const toolRows = imageToolDefinitions.map(([id, label, icon]) => `<div class="image-tool-row" data-tool-row="${id}"><input type="checkbox" data-image-toggle="${id}" aria-label="Enable ${label}"><button type="button" data-image-tool="${id}" aria-pressed="${id === this.tool}"><span class="image-tool-icon">${imageIcon(icon)}</span><span>${label}</span></button></div>`).join('');
    host.innerHTML = [
      `<div class="image-shell" data-mode="viewer" data-atlas="false" data-browser-open="${window.innerWidth > 1100}">`,
      '<div class="image-ribbon" data-role="ribbon"><div class="image-ribbon-list" id="image-ribbon-list" data-role="ribbon-list"></div><div class="image-ribbon-scrollbar" data-role="ribbon-scrollbar" role="scrollbar" aria-label="Scroll images" aria-controls="image-ribbon-list" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0" hidden><div class="image-ribbon-scrollbar-thumb" data-role="ribbon-scrollbar-thumb"></div></div></div>',
      '<div class="image-editor-layout">',
      `<aside class="image-browser"><div class="image-browser-tools"><input data-role="search" type="search" placeholder="Find images…" aria-label="Find images"><button data-image-action="view" title="Thumbnail view" aria-label="Thumbnail view">${imageIcon(imageUiIcons.grid)}</button></div>`,
      '<div class="image-browser-content" data-role="browser-scroll"><div class="image-browser-tree" data-role="browser-tree" aria-label="Folders"></div><div class="image-browser-list" data-role="browser-list" aria-label="Images in current folder"></div></div><div class="image-browser-foot"><span data-role="selected-count">0 selected</span><button data-image-action="select-all">Select all</button></div></aside>',
      '<div class="image-browser-divider" role="separator" aria-label="Resize files panel" aria-orientation="vertical" tabindex="0"></div>',
      '<section class="image-center"><div class="image-preview" data-role="preview"><div class="image-stage" data-role="stage"><div class="image-stage-inner"><div class="image-loop-surface" data-role="loop-surface"><div class="image-canvas-stack" data-role="stack"><canvas data-role="canvas"></canvas><canvas data-role="overlay"></canvas></div></div><img data-role="animation" alt=""></div></div></div>',
      `<div class="image-stage-bar"><button type="button" class="image-browser-toggle" data-image-action="toggle-browser" aria-label="Toggle files panel" aria-expanded="${window.innerWidth > 1100}">${imageIcon(imageUiIcons.folder)}<span>Files</span></button><span data-role="status">Ready</span><div class="image-bar-actions"><label>Zoom <select data-role="zoom"><option value="fit">Fit</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option><option value="custom" hidden>Custom</option></select></label></div></div></section>`,
      '<div class="image-inspector-divider" role="separator" aria-label="Resize tools panel" aria-orientation="vertical" tabindex="0"></div>',
      `<aside class="image-inspector"><div class="image-tool-head"><strong>Tools</strong></div><nav class="image-tool-list" aria-label="Image tools">${toolRows}</nav><div class="image-panel-divider" data-resize-panel="tools" role="separator" aria-label="Resize tools list" aria-orientation="horizontal" tabindex="0"></div><div class="image-tool-detail"><div class="image-tool-panel" data-tool-panel="alpha-mask" hidden><h2>Alpha mask</h2><p>Red marks fully transparent pixels. Blue marks partially transparent pixels; lighter blue means greater opacity.</p><label>Mask <select data-role="mask"><option value="both" selected>Both</option><option value="full">Fully transparent</option><option value="partial">Partially transparent</option></select></label></div>`,
      '<div class="image-tool-panel image-atlas-tools" data-tool-panel="atlas" hidden><h2>Atlas</h2><p>Select images, then enable Atlas to build a preview at their original resolution.</p>',
      '<label class="image-check"><input data-role="atlas-auto-size" type="checkbox" checked>Automatic size</label>',
      '<label>Layout <select data-role="atlas-mode"><option value="auto">Automatic packing</option><option value="grid">Regular grid</option></select></label>',
      '<label data-atlas-manual hidden>Maximum width <input data-role="atlas-width" type="number" min="1" max="16384" value="2048"></label>',
      '<label data-atlas-manual hidden>Maximum height <input data-role="atlas-height" type="number" min="1" max="16384" value="2048"></label>',
      '<label>Padding <input data-role="atlas-padding" type="number" min="0" max="256" value="2"></label></div>',
      '<div class="image-tool-panel" data-tool-panel="auto-cutout"><h2>Auto cutout</h2><p>Detect the subject on a solid or baked checkerboard background and preserve clean, soft edges.</p></div>',
      ...['brightness', 'contrast', 'saturation', 'sharpness'].map(name => `<div class="image-tool-panel" data-tool-panel="${name}" hidden><h2>${name[0].toUpperCase() + name.slice(1)}</h2><label>${name[0].toUpperCase() + name.slice(1)} <output data-role="${name}-value">0</output><input data-adjust="${name}" type="range" min="${name === 'sharpness' ? 0 : -100}" max="100" value="0"></label></div>`),
      '<div class="image-tool-panel" data-tool-panel="crop" hidden><h2>Crop</h2><p>Drag a rectangle over the image, then apply.</p></div>',
      '<div class="image-tool-panel" data-tool-panel="flip-h" hidden><h2>Flip horizontal</h2><p>Mirror the whole image from left to right.</p></div><div class="image-tool-panel" data-tool-panel="flip-v" hidden><h2>Flip vertical</h2><p>Mirror the whole image from top to bottom.</p></div>',
      '<div class="image-tool-panel" data-tool-panel="loop-texture" hidden><h2>Loop texture</h2><p>Make a seamless square texture for repeating on a 3D surface. The canvas previews a 3 × 3 repeat; saving exports one tile. Non-square images are cropped from the center before resizing.</p><label>Texture size <output data-role="loop-size-value">512 × 512</output><input data-role="loop-size" type="range" min="7" max="12" step="1" value="9" aria-label="Loop texture size"></label><label>Blend width <output data-role="loop-blend-value">30%</output><input data-role="loop-blend" type="range" min="5" max="50" step="1" value="30" aria-label="Loop texture blend width"></label></div>',
      '<div class="image-tool-panel" data-tool-panel="remove-grid" hidden><h2>Remove checkerboard</h2><p>Automatically remove a baked checkerboard and refine the object edges.</p></div>',
      '<div class="image-tool-panel" data-tool-panel="remove-color" hidden><h2>Remove color</h2><div class="image-color-line"><button data-image-action="pick">Pick color</button><input data-role="key-color" type="color" value="#ffffff" aria-label="Background color"></div><label>Tolerance <output data-role="tolerance-value">24</output><input data-role="tolerance" type="range" min="0" max="160" value="24"></label><label>Softness <output data-role="softness-value">16</output><input data-role="softness" type="range" min="0" max="100" value="16"></label></div>',
      '<div class="image-tool-panel image-resize" data-tool-panel="resize" hidden><h2>Resize</h2><label>Width <input data-role="resize-width" type="number" min="1" max="16384"></label><label>Height <input data-role="resize-height" type="number" min="1" max="16384"></label><label class="image-check"><input data-role="aspect" type="checkbox" checked>Keep aspect ratio</label></div>',
      '<div class="image-tool-panel" data-tool-panel="rotate" hidden><h2>Rotate</h2><p>Negative angles turn left; positive angles turn right. The canvas expands to fit the image.</p><label>Angle <output data-role="rotate-angle-value">0°</output><input data-role="rotate-angle" type="range" min="-180" max="180" step="1" value="0" aria-label="Rotation angle"></label><div class="image-rotate-scale"><span>−180°</span><span>0°</span><span>+180°</span></div></div>',
      '<div class="image-tool-panel" data-tool-panel="trim" hidden><h2>Trim transparent</h2><p>Remove fully transparent borders around the subject.</p></div></div>',
      '<div class="image-panel-divider" data-resize-panel="history" role="separator" aria-label="Resize history panel" aria-orientation="horizontal" tabindex="0"></div>',
      `<section class="image-history"><div class="image-history-head"><strong>${imageIcon(imageUiIcons.history)} History</strong><div><button type="button" data-image-action="reset" aria-label="Reset original" title="Reset original">${imageIcon(imageUiIcons.reset)}<span>Reset</span></button><button type="button" data-image-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${imageIcon(imageUiIcons.undo)}</button><button type="button" data-image-action="redo" aria-label="Redo" title="Redo (Ctrl+Y)">${imageIcon(imageUiIcons.redo)}</button></div></div><ol class="image-history-list" data-role="history-list"></ol></section>`,
      `<div class="image-apply-bar"><button type="button" data-image-action="save">${imageIcon(imageUiIcons.save)}<span>Save</span></button><button type="button" class="primary" data-image-action="save-as">${imageIcon(imageUiIcons.saveAs)}<span>Save as</span></button></div></aside></div></div>`
    ].join('');
    this.el = host.firstElementChild;
    this.el.addEventListener('click', event => {
      const tool = event.target.closest('[data-image-tool]');
      if (tool) { this.selectTool(tool.dataset.imageTool); return; }
      const step = event.target.closest('[data-history-index]');
      if (step) { this.jumpHistory(Number(step.dataset.historyIndex)); return; }
      const treeExpand = event.target.closest('[data-tree-expand]');
      if (treeExpand) { void this.toggleTree(treeExpand.dataset.treeExpand).catch(error => this.message(error.message)); return; }
      const folder = event.target.closest('[data-browse-relative], [data-image-location]') || event.target.closest('.image-tree-line')?.querySelector('.image-tree-item');
      if (folder) { void this.activateTreeFolder(folder).catch(error => this.message(error.message)); return; }
      const target = event.target.closest('[data-image-action]');
      if (target) void this.command(target.dataset.imageAction).catch(error => this.message(error.message));
    });
    this.el.addEventListener('change', event => {
      const toggle = event.target.closest('[data-image-toggle]');
      if (toggle) void this.toggleEffect(toggle.dataset.imageToggle, toggle.checked).catch(error => { toggle.checked = this.effectEnabled(toggle.dataset.imageToggle); this.message(error.message); });
    });
    this.el.addEventListener('dragstart', event => {
      const row = event.target.closest('.image-file-row, .image-ribbon-item');
      const browser = row?.classList.contains('image-ribbon-item') ? this.documentBrowser : this.browser;
      if (!row?.dataset.relative || !browser || !window.desktop?.imageStartDrag) return;
      event.preventDefault();
      const entry = browser.entries.find(entry => entry.relative === row.dataset.relative);
      const sameFolder = this.browser && this.treeKey(this.browser.folder) === this.treeKey(browser.folder);
      const selectedNames = new Set(sameFolder ? this.browser.entries.filter(entry => this.selection.has(entry.relative)).map(entry => entry.name) : []);
      const relatives = selectedNames.has(entry?.name)
        ? [row.dataset.relative, ...browser.entries.filter(entry => !entry.directory && entry.relative !== row.dataset.relative && selectedNames.has(entry.name)).map(entry => entry.relative)]
        : [row.dataset.relative];
      window.desktop.imageStartDrag(browser.sessionId, row.dataset.relative, relatives);
    });
    this.disposeDragError = window.desktop?.onImageDragError?.(error => this.message(error));
    this.el.addEventListener('contextmenu', event => { void this.contextMenu(event).catch(error => this.message(error.message)); });
    this.el.querySelector('[data-role="stage"]').addEventListener('dblclick', () => { void this.setMode(this.mode === 'viewer' ? 'editor' : 'viewer').catch(error => this.message(error.message)); });
    this.el.querySelector('[data-role="stage"]').addEventListener('click', event => this.imageClick(event));
    this.el.querySelector('[data-role="stage"]').addEventListener('pointerdown', event => this.imagePress(event));
    this.el.querySelector('[data-role="stage"]').addEventListener('wheel', event => { void this.stageWheel(event).catch(error => this.message(error.message)); }, { passive: false });
    this.q('ribbon-list').addEventListener('scroll', () => this.updateRibbonScrollbar(), { passive: true });
    this.q('ribbon-list').addEventListener('wheel', event => {
      const list = this.q('ribbon-list');
      if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
    }, { passive: false });
    this.q('ribbon-scrollbar').addEventListener('pointerdown', event => this.dragRibbonScrollbar(event));
    this.q('ribbon-scrollbar').addEventListener('keydown', event => {
      const list = this.q('ribbon-list');
      if (event.key === 'ArrowLeft') list.scrollLeft -= 90;
      else if (event.key === 'ArrowRight') list.scrollLeft += 90;
      else if (event.key === 'Home') list.scrollLeft = 0;
      else if (event.key === 'End') list.scrollLeft = list.scrollWidth;
      else return;
      event.preventDefault();
    });
    this.el.querySelector('[data-role="overlay"]').addEventListener('pointerdown', event => this.cropStart(event));
    this.el.querySelector('[data-role="overlay"]').addEventListener('pointermove', event => this.cropMove(event));
    this.el.querySelector('[data-role="overlay"]').addEventListener('pointerup', event => this.cropEnd(event));
    this.el.querySelector('[data-role="overlay"]').addEventListener('pointercancel', event => this.cropEnd(event));
    this.el.querySelector('[data-role="search"]').addEventListener('input', () => { this.renderBrowser(); if (this.q('search').value.trim()) this.q('browser-list').scrollIntoView({ block: 'start' }); });
    this.el.querySelector('[data-role="zoom"]').addEventListener('change', event => { this.zoom = event.target.value === 'fit' ? 'fit' : Number(event.target.value); this.layoutCanvas(); });
    this.el.querySelector('[data-role="mask"]').addEventListener('change', () => { if (this.effectEnabled('alpha-mask')) void this.updateEffect('alpha-mask', true).catch(error => this.message(error.message)); });
    for (const input of this.el.querySelectorAll('[data-adjust]')) {
      input.addEventListener('input', () => { this.q(input.dataset.adjust + '-value').textContent = input.value; void this.updateEffect(input.dataset.adjust, true, false).catch(error => this.message(error.message)); });
      input.addEventListener('change', () => { void this.updateEffect(input.dataset.adjust, true, true).catch(error => this.message(error.message)); });
    }
    this.q('rotate-angle').addEventListener('input', () => {
      this.syncRotateLabel();
      void this.updateEffect('rotate', true, false).catch(error => this.message(error.message));
    });
    this.q('rotate-angle').addEventListener('change', () => {
      void this.updateEffect('rotate', true, true).catch(error => this.message(error.message));
    });
    for (const role of ['tolerance', 'softness']) this.el.querySelector('[data-role="' + role + '"]').addEventListener('input', event => { this.el.querySelector('[data-role="' + role + '-value"]').textContent = event.target.value; });
    for (const role of ['tolerance', 'softness', 'key-color', 'atlas-mode', 'atlas-auto-size', 'atlas-width', 'atlas-height', 'atlas-padding']) {
      this.q(role).addEventListener('change', () => {
        if (role.startsWith('atlas-')) {
          for (const label of this.el.querySelectorAll('[data-atlas-manual]')) label.hidden = this.q('atlas-auto-size').checked;
          if (this.atlasMode) void this.buildAtlas().catch(error => this.message(error.message));
        }
        else if (this.effectEnabled('remove-color')) void this.updateEffect('remove-color', true).catch(error => this.message(error.message));
      });
    }
    for (const dimension of ['width', 'height']) {
      const input = this.q('resize-' + dimension);
      input.addEventListener('input', () => { this.syncAspect(dimension); void this.updateEffect('resize', true, false).catch(error => this.message(error.message)); });
      input.addEventListener('change', () => { void this.updateEffect('resize', true, true).catch(error => this.message(error.message)); });
    }
    for (const role of ['loop-size', 'loop-blend']) {
      this.q(role).addEventListener('input', () => this.syncLoopLabels());
      this.q(role).addEventListener('change', () => {
        if (this.effectEnabled('loop-texture')) void this.updateEffect('loop-texture', true).catch(error => this.message(error.message));
      });
    }
    this.resizeObserver = new ResizeObserver(() => { this.limitBrowserWidth(); this.limitInspectorWidth(); this.limitInspectorHeights(); this.layoutCanvas(); this.updateRibbonScrollbar(); });
    this.resizeObserver.observe(this.el.querySelector('[data-role="stage"]'));
    this.resizeObserver.observe(this.q('ribbon-list'));
    this.resizeObserver.observe(this.el.querySelector('.image-inspector'));
    this.thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        this.thumbObserver.unobserve(entry.target);
        const { session, relative } = entry.target.dataset;
        if (window.desktop?.imageDecode) void window.desktop.imageDecode(session, relative, true).then(url => { if (entry.target.isConnected) entry.target.src = url; }).catch(() => {});
      }
    }, { root: this.el });
    this.installBrowserDivider();
    this.installInspectorDividers();
    this.selectTool(this.tool);
  }
  get dirty() { return this.index >= 0 && (this.index !== this.savedIndex || this.hasAdjustments()); }
  q(role) { return this.el.querySelector('[data-role="' + role + '"]'); }
  current() { return this.history[this.index] || null; }
  hasAdjustments() { return Boolean(this.previewPixels); }
  visiblePixels() { return this.previewPixels || this.current(); }
  cloneEffects(effects = this.effects) { return effects.map(effect => ({ id: effect.id, enabled: effect.enabled, params: structuredClone(effect.params || {}) })); }
  pixelEffects(effects = this.effects) { return effects.filter(effect => !['alpha-mask', 'atlas'].includes(effect.id)); }
  effectEnabled(id) { return id === 'atlas' ? this.atlasMode : this.effects.some(effect => effect.id === id && effect.enabled); }
  effectParams(id) {
    if (['brightness', 'contrast', 'saturation', 'sharpness'].includes(id)) return { value: Number(this.el.querySelector(`[data-adjust="${id}"]`).value) };
    if (id === 'crop') return { rect: this.crop && { ...this.crop } };
    if (id === 'resize') return { width: Number(this.q('resize-width').value), height: Number(this.q('resize-height').value) };
    if (id === 'rotate') return { angle: Number(this.q('rotate-angle').value) };
    if (id === 'loop-texture') return { size: 2 ** Number(this.q('loop-size').value), blend: Number(this.q('loop-blend').value) };
    if (id === 'remove-color') return { color: hex(this.q('key-color').value), tolerance: Number(this.q('tolerance').value), softness: Number(this.q('softness').value) };
    if (id === 'alpha-mask') return { mode: this.q('mask').value };
    return {};
  }
  renderToolChecks() {
    for (const input of this.el.querySelectorAll('[data-image-toggle]')) input.checked = input.dataset.imageToggle === 'crop' && this.cropPending || this.effectEnabled(input.dataset.imageToggle);
  }
  renderEffectControls() {
    this.resetAdjustments(); this.q('mask').value = 'both'; this.q('key-color').value = '#ffffff';
    this.resetLoopControls(); this.resetRotateControls();
    this.q('tolerance').value = '24'; this.q('softness').value = '16';
    this.q('tolerance-value').textContent = '24'; this.q('softness-value').textContent = '16';
    for (const effect of this.effects) {
      const { id, params = {} } = effect;
      if (['brightness', 'contrast', 'saturation', 'sharpness'].includes(id)) {
        const input = this.el.querySelector(`[data-adjust="${id}"]`); input.value = String(params.value ?? 0); this.q(id + '-value').textContent = input.value;
      } else if (id === 'resize') {
        this.q('resize-width').value = params.width ?? this.current()?.width ?? '';
        this.q('resize-height').value = params.height ?? this.current()?.height ?? '';
      } else if (id === 'rotate') {
        this.q('rotate-angle').value = String(params.angle ?? 0);
      } else if (id === 'loop-texture') {
        this.q('loop-size').value = String(Math.log2(params.size ?? 512));
        this.q('loop-blend').value = String(params.blend ?? 30);
      } else if (id === 'remove-color') {
        if (params.color) this.q('key-color').value = '#' + params.color.map(value => value.toString(16).padStart(2, '0')).join('');
        this.q('tolerance').value = params.tolerance ?? 24; this.q('softness').value = params.softness ?? 16;
        this.q('tolerance-value').textContent = this.q('tolerance').value; this.q('softness-value').textContent = this.q('softness').value;
      } else if (id === 'alpha-mask') this.q('mask').value = params.mode || 'both';
    }
    this.syncLoopLabels(); this.syncRotateLabel();
    const mask = this.effects.find(effect => effect.id === 'alpha-mask'); this.maskMode = mask?.enabled ? mask.params.mode : 'off';
    this.renderToolChecks();
  }
  async load(descriptor) {
    let sourceURL = descriptor.sessionId && window.desktop?.imageRead ? await window.desktop.imageRead(descriptor.sessionId, descriptor.relative) : descriptor.url;
    if (!sourceURL) throw new Error('Image source is unavailable.');
    if (sourceURL.startsWith('blob:')) sourceURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
      fetch(sourceURL).then(response => response.blob()).then(blob => reader.readAsDataURL(blob), reject);
    });
    const pixels = await staticPixels(sourceURL, imageExtension(descriptor.name));
    return { descriptor, sourceURL, pixels };
  }
  install(result) {
    const { descriptor, sourceURL, pixels } = result;
    const sameBrowser = this.sameFolderContents(this.browser, descriptor.browser);
    const sameRibbon = this.sameFolderContents(this.documentBrowser, descriptor.browser);
    this.documentId = descriptor.documentId || null; this.sessionId = descriptor.sessionId || null;
    this.relative = descriptor.relative || ''; this.name = descriptor.name; this.animated = imageExtension(descriptor.name) === 'gif';
    this.sourceURL = sourceURL; this.originalPixels = pixels; this.history = [pixels]; this.historyLabels = ['Open image']; this.historyEffects = [[]]; this.effects = []; this.previewPixels = null; this.index = 0; this.savedIndex = 0;
    this.crop = null; this.cropPending = false; this.cropping = false; this.pickColor = false; this.maskMode = 'off'; this.atlasMode = false; this.atlas = null; this.el.dataset.atlas = 'false';
    this.resetAdjustments();
    this.resetLoopControls(); this.resetRotateControls();
    if (descriptor.browser) {
      if (!sameRibbon) this.documentBrowser = descriptor.browser;
      if (!sameBrowser) {
        if (this.browser?.folder !== descriptor.browser.folder) { this.selection.clear(); this.selectionAnchor = null; }
        this.browser = descriptor.browser;
        this.treeExpanded.add('path:' + this.treeKey(descriptor.browser.folder));
        void this.refreshTree(descriptor.browser).catch(error => this.message(error.message));
      }
    } else { this.treeRevision++; this.browser = null; this.documentBrowser = null; this.selection.clear(); this.selectionAnchor = null; }
    this.mode = descriptor.preferredMode === 'editor' ? 'editor' : 'viewer'; this.zoom = 'fit'; this.q('zoom').value = 'fit';
    if (this.animated) this.q('animation').src = sourceURL; else this.q('animation').removeAttribute('src');
    this.selectTool('auto-cutout'); this.syncDimensions(); this.renderToolChecks(); this.renderHistory();
    if (sameBrowser) this.updateBrowserCurrent();
    else { this.renderBrowser(); this.renderTree({ reveal: true }); }
    if (sameRibbon) this.updateRibbonCurrent(); else this.renderRibbon();
    this.renderStage();
    this.changed(this.dirty);
    if (window.desktop?.imageFullscreen) void this.setMode(this.mode).catch(error => this.message(error.message));
    else { this.el.dataset.mode = this.mode; this.renderStage(); this.updateRibbonScrollbar(); }
    if (this.animated) this.message('Animated GIF preview is preserved. Editing and export use the first frame only.');
  }
  async setMode(mode) {
    if (!['viewer', 'editor'].includes(mode)) return;
    if (window.desktop?.imageFullscreen) await window.desktop.imageFullscreen(mode === 'viewer');
    else if (mode === 'viewer' && !document.fullscreenElement) await this.el.requestFullscreen();
    else if (mode === 'editor' && document.fullscreenElement) await document.exitFullscreen();
    this.mode = mode; this.el.dataset.mode = mode; this.limitBrowserWidth(); this.limitInspectorWidth(); this.limitInspectorHeights(); this.renderStage(); this.updateRibbonScrollbar();
    if (mode === 'editor') this.scrollCurrentTreeFolder();
  }
  onWindowFullscreen(fullscreen) { this.mode = fullscreen ? 'viewer' : 'editor'; this.el.dataset.mode = this.mode; this.limitBrowserWidth(); this.limitInspectorWidth(); this.limitInspectorHeights(); this.renderStage(); this.updateRibbonScrollbar(); if (!fullscreen) this.scrollCurrentTreeFolder(); }
  push(pixels, label = 'Edit image') {
    checkImage(pixels);
    if (this.savedIndex > this.index) this.savedIndex = -1;
    this.history = this.history.slice(0, this.index + 1);
    this.historyLabels = this.historyLabels.slice(0, this.index + 1);
    this.historyEffects = this.historyEffects.slice(0, this.index + 1);
    this.history.push(pixels); this.historyLabels.push(label); this.historyEffects.push(this.cloneEffects()); this.index++; this.previewPixels = null;
    while (this.history.length > 1 && this.history.reduce((sum, item) => sum + item.data.byteLength, 0) > 160 * 1024 * 1024) {
      this.history.shift(); this.historyLabels.shift(); this.historyEffects.shift(); this.index--; this.savedIndex = Math.max(-1, this.savedIndex - 1);
    }
    this.crop = null; this.syncDimensions(); this.renderToolChecks(); this.renderHistory(); this.renderStage(); this.changed(this.dirty);
  }
  syncDimensions() {
    if (!this.current()) return;
    const resize = this.effects.find(effect => effect.id === 'resize');
    this.q('resize-width').value = resize?.params?.width ?? this.current().width;
    this.q('resize-height').value = resize?.params?.height ?? this.current().height;
  }
  renderHistory() {
    const list = this.q('history-list'); list.replaceChildren();
    for (let index = 0; index < this.historyLabels.length; index++) {
      const item = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'image-history-row';
      button.dataset.historyIndex = String(index); button.textContent = `${index + 1}. ${this.historyLabels[index]}`;
      if (index === this.index) button.setAttribute('aria-current', 'step');
      item.append(button); list.append(item);
    }
    this.el.querySelector('[data-image-action="undo"]').disabled = this.index <= 0 && !this.hasAdjustments();
    this.el.querySelector('[data-image-action="redo"]').disabled = this.index >= this.history.length - 1;
    this.el.querySelector('[data-image-action="reset"]').disabled = !this.current();
  }
  jumpHistory(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.history.length) return;
    this.index = index; this.effects = this.cloneEffects(this.historyEffects[index]); this.previewPixels = null; this.cropPending = false; this.atlasMode = false; this.atlas = null; this.el.dataset.atlas = 'false';
    this.crop = null; this.syncDimensions(); this.renderEffectControls(); this.renderHistory(); this.renderStage(); this.changed(this.dirty);
  }
  resetAdjustments() {
    for (const input of this.el.querySelectorAll('[data-adjust]')) { input.value = '0'; this.q(input.dataset.adjust + '-value').textContent = '0'; }
  }
  resetRotateControls() { this.q('rotate-angle').value = '0'; this.syncRotateLabel(); }
  syncRotateLabel() {
    const angle = Number(this.q('rotate-angle').value);
    this.q('rotate-angle-value').textContent = (angle > 0 ? '+' : '') + angle + '°';
  }
  resetLoopControls() {
    const dimension = Math.min(this.originalPixels?.width || 512, this.originalPixels?.height || 512);
    this.q('loop-size').value = String(Math.max(7, Math.min(12, Math.round(Math.log2(dimension)))));
    this.q('loop-blend').value = '30';
    this.syncLoopLabels();
  }
  syncLoopLabels() {
    const size = 2 ** Number(this.q('loop-size').value);
    this.q('loop-size-value').textContent = `${size} × ${size}`;
    this.q('loop-blend-value').textContent = this.q('loop-blend').value + '%';
  }
  commitAdjustments(label = 'Color adjustment') { if (this.previewPixels) this.push(this.previewPixels, label); }
  loopPreviewActive() { return this.mode === 'editor' && this.tool === 'loop-texture' && !this.atlasMode; }
  clearLoopPreview() {
    this.loopPreviewRevision++; this.loopPreviewPixels = null; this.loopPreviewPending = null;
    if (this.loopPreviewUrl) URL.revokeObjectURL(this.loopPreviewUrl);
    this.loopPreviewUrl = null;
    const surface = this.q('loop-surface');
    surface.classList.remove('has-image');
    surface.style.removeProperty('--image-loop-url');
  }
  renderLoopPreview(pixels, canvas) {
    const surface = this.q('loop-surface'), active = this.loopPreviewActive();
    surface.classList.toggle('is-active', active);
    if (!active) {
      if (this.loopPreviewUrl || this.loopPreviewPending) this.clearLoopPreview();
      return;
    }
    if (this.loopPreviewPixels === pixels || this.loopPreviewPending === pixels) return;
    this.clearLoopPreview();
    this.loopPreviewPending = pixels;
    const revision = this.loopPreviewRevision;
    canvas.toBlob(blob => {
      if (revision !== this.loopPreviewRevision || !surface.isConnected) return;
      this.loopPreviewPending = null;
      if (!blob) return;
      this.loopPreviewUrl = URL.createObjectURL(blob);
      this.loopPreviewPixels = pixels;
      surface.style.setProperty('--image-loop-url', `url("${this.loopPreviewUrl}")`);
      surface.classList.add('has-image');
    }, 'image/png');
  }
  renderStage() {
    const pixels = this.atlasMode && this.atlas ? this.atlas.pixels : this.visiblePixels();
    if (!pixels) return;
    const canvas = this.q('canvas');
    if (canvas.width !== pixels.width || canvas.height !== pixels.height) { canvas.width = pixels.width; canvas.height = pixels.height; }
    canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    const animate = this.animated && this.mode === 'viewer' && !this.effects.some(effect => effect.enabled && effect.id !== 'alpha-mask') && !this.hasAdjustments() && !this.atlasMode;
    this.q('animation').hidden = !animate; this.q('stack').hidden = animate;
    this.q('overlay').style.pointerEvents = this.cropping ? 'auto' : 'none';
    this.renderLoopPreview(pixels, canvas);
    this.renderOverlay(); this.layoutCanvas();
    this.q('status').textContent = (this.atlasMode && this.atlas ? 'Atlas' : this.name) + ' · ' + pixels.width + ' × ' + pixels.height + (this.dirty ? ' · unsaved' : '') + (this.loopPreviewActive() ? ' · 3 × 3 tiling preview' : '') + (this.animated && !this.atlasMode ? ' · GIF first frame for edits' : '');
  }
  layoutCanvas() {
    const pixels = this.atlasMode && this.atlas ? this.atlas.pixels : this.visiblePixels();
    if (!pixels) return;
    const scale = this.currentScale();
    const width = Math.max(1, Math.round(pixels.width * scale)), height = Math.max(1, Math.round(pixels.height * scale));
    this.q('stack').style.width = width + 'px';
    this.q('stack').style.height = height + 'px';
    const surface = this.q('loop-surface');
    if (this.loopPreviewActive()) {
      surface.style.width = width * 3 + 'px'; surface.style.height = height * 3 + 'px';
      surface.style.setProperty('--image-loop-tile-size', `${width}px ${height}px`);
    } else { surface.style.width = ''; surface.style.height = ''; }
    this.q('animation').style.width = Math.max(1, Math.round(pixels.width * scale)) + 'px';
    this.q('animation').style.height = Math.max(1, Math.round(pixels.height * scale)) + 'px';
  }
  currentScale() {
    const pixels = this.atlasMode && this.atlas ? this.atlas.pixels : this.visiblePixels();
    if (!pixels) return 1;
    const stage = this.q('stage');
    const tiles = this.loopPreviewActive() ? 3 : 1;
    return this.zoom === 'fit' ? Math.min(1, Math.max(0.01, (stage.clientWidth - 40) / (pixels.width * tiles)), Math.max(0.01, (stage.clientHeight - 40) / (pixels.height * tiles))) : this.zoom;
  }
  zoomTo(scale, clientX, clientY) {
    if (!this.current()) return;
    const stage = this.q('stage'), image = this.q('stack').hidden ? this.q('animation') : this.loopPreviewActive() ? this.q('loop-surface') : this.q('stack');
    const before = image.getBoundingClientRect(), x = before.width ? (clientX - before.left) / before.width : .5, y = before.height ? (clientY - before.top) / before.height : .5;
    this.zoom = Math.max(.05, Math.min(16, scale)); this.layoutCanvas();
    const custom = this.q('zoom').querySelector('[value="custom"]'); custom.textContent = Math.round(this.zoom * 100) + '%'; this.q('zoom').value = 'custom';
    const after = image.getBoundingClientRect();
    stage.scrollLeft += after.left + x * after.width - clientX;
    stage.scrollTop += after.top + y * after.height - clientY;
  }
  async stageWheel(event) {
    if (!this.current()) return;
    event.preventDefault();
    if (!event.deltaY) return;
    if (this.mode === 'viewer') {
      const now = performance.now();
      if (this.wheelNavigationPending || now < (this.wheelNavigationAfter || 0)) return;
      const browser = this.documentBrowser;
      const entries = browser?.entries.filter(entry => !entry.directory) || [];
      const index = entries.findIndex(entry => entry.relative === this.relative);
      const next = index < 0 ? null : entries[index + Math.sign(event.deltaY)];
      if (!next) return;
      this.wheelNavigationPending = true; this.wheelNavigationAfter = now + 250;
      try { await this.selectFile(next.relative, browser.sessionId); }
      finally { this.wheelNavigationPending = false; }
      return;
    }
    this.zoomTo(this.currentScale() * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY);
  }
  imageClick(event) {
    if (!event.target.matches('canvas, img[data-role="animation"]')) return;
    if (this.pickColor) this.pick(event);
  }
  imagePress(event) {
    const onImage = event.target.matches('canvas, img[data-role="animation"]') || (this.loopPreviewActive() && event.target.closest('[data-role="loop-surface"]'));
    if (event.button !== 0 || !event.isPrimary || !this.current() || this.pickColor || this.cropping || this.pressZoom || !onImage) return;
    const stage = this.q('stage');
    const previous = { zoom: this.zoom, select: this.q('zoom').value, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
    this.zoomTo(this.currentScale() * 2, event.clientX, event.clientY);
    const controller = new AbortController();
    this.pressZoom = { pointerId: event.pointerId, controller };
    stage.setPointerCapture(event.pointerId);
    const release = released => {
      if (released?.pointerId !== undefined && released.pointerId !== event.pointerId) return;
      controller.abort(); this.pressZoom = null;
      this.zoom = previous.zoom; this.q('zoom').value = previous.select; this.layoutCanvas();
      stage.scrollLeft = previous.scrollLeft; stage.scrollTop = previous.scrollTop;
    };
    window.addEventListener('pointerup', release, { signal: controller.signal });
    window.addEventListener('pointercancel', release, { signal: controller.signal });
    window.addEventListener('blur', release, { signal: controller.signal });
    stage.addEventListener('lostpointercapture', release, { signal: controller.signal });
  }
  renderOverlay() {
    const pixels = this.atlasMode && this.atlas ? this.atlas.pixels : this.visiblePixels();
    if (!pixels) return;
    const overlay = this.q('overlay');
    if (overlay.width !== pixels.width || overlay.height !== pixels.height) { overlay.width = pixels.width; overlay.height = pixels.height; }
    const context = overlay.getContext('2d'); context.clearRect(0, 0, pixels.width, pixels.height);
    if (this.maskMode !== 'off' && !this.atlasMode) {
      const mask = alphaMask(pixels, this.maskMode);
      context.putImageData(new ImageData(mask.data, mask.width, mask.height), 0, 0);
    }
    if (this.crop && !this.atlasMode) {
      context.fillStyle = '#468ef733'; context.strokeStyle = '#86b7ff'; context.lineWidth = Math.max(1, Math.round(pixels.width / 800));
      context.fillRect(this.crop.x, this.crop.y, this.crop.width, this.crop.height);
      context.strokeRect(this.crop.x + .5, this.crop.y + .5, this.crop.width, this.crop.height);
    }
  }
  point(event) {
    const rect = this.q('canvas').getBoundingClientRect(), pixels = this.visiblePixels();
    return { x: Math.max(0, Math.min(pixels.width - 1, Math.floor((event.clientX - rect.left) * pixels.width / rect.width))), y: Math.max(0, Math.min(pixels.height - 1, Math.floor((event.clientY - rect.top) * pixels.height / rect.height))) };
  }
  pick(event) {
    if (!this.pickColor || !this.current() || this.atlasMode) return;
    const point = this.point(event), pixels = this.visiblePixels(), i = (point.y * pixels.width + point.x) * 4;
    this.q('key-color').value = '#' + [0, 1, 2].map(c => pixels.data[i + c].toString(16).padStart(2, '0')).join('');
    this.pickColor = false; this.q('canvas').classList.remove('is-picking');
    void this.updateEffect('remove-color', true).catch(error => this.message(error.message));
    this.message('Background color selected.');
  }
  cropStart(event) {
    if (!this.cropping || event.button !== 0 || this.atlasMode) return;
    event.preventDefault(); this.q('overlay').setPointerCapture(event.pointerId);
    this.cropAnchor = this.point(event); this.crop = { x: this.cropAnchor.x, y: this.cropAnchor.y, width: 1, height: 1 }; this.renderOverlay();
  }
  cropMove(event) {
    if (!this.cropAnchor) return;
    const point = this.point(event);
    this.crop = { x: Math.min(this.cropAnchor.x, point.x), y: Math.min(this.cropAnchor.y, point.y), width: Math.abs(point.x - this.cropAnchor.x) + 1, height: Math.abs(point.y - this.cropAnchor.y) + 1 };
    this.renderOverlay();
  }
  cropEnd(event) {
    if (!this.cropAnchor) return;
    this.cropMove(event); this.cropAnchor = null;
    if (this.crop && this.crop.width > 1 && this.crop.height > 1) {
      this.cropPending = false; this.cropping = false; void this.updateEffect('crop', true).catch(error => this.message(error.message));
    }
  }
  syncAspect(changed) {
    if (!this.q('aspect').checked || !this.current()) return;
    const current = this.current(), width = this.q('resize-width'), height = this.q('resize-height');
    if (changed === 'width' && Number(width.value) > 0) height.value = Math.max(1, Math.round(Number(width.value) * current.height / current.width));
    if (changed === 'height' && Number(height.value) > 0) width.value = Math.max(1, Math.round(Number(height.value) * current.width / current.height));
  }
  selectTool(id) {
    if (!imageToolDefinitions.some(([name]) => name === id)) return;
    if (this.tool !== id && this.previewPixels) this.commitAdjustments(imageToolDefinitions.find(([name]) => name === this.tool)?.[1]);
    this.tool = id;
    for (const row of this.el.querySelectorAll('[data-image-tool]')) row.setAttribute('aria-pressed', String(row.dataset.imageTool === id));
    for (const panel of this.el.querySelectorAll('[data-tool-panel]')) panel.hidden = panel.dataset.toolPanel !== id;
    this.cropping = id === 'crop' && (!this.effectEnabled('crop') || this.cropPending);
    if (!this.cropping) { this.crop = null; this.cropPending = false; }
    if (id !== 'remove-color') { this.pickColor = false; this.q('canvas').classList.remove('is-picking'); }
    if (id !== 'atlas') { this.atlasMode = false; this.el.dataset.atlas = 'false'; }
    this.renderToolChecks();
    this.renderStage();
  }
  resetOriginal() {
    if (!this.current()) return;
    this.effects = []; this.previewPixels = null; this.crop = null; this.cropPending = false; this.maskMode = 'off'; this.atlasMode = false; this.el.dataset.atlas = 'false';
    this.resetAdjustments(); this.resetRotateControls(); this.syncDimensions(); this.push(this.originalPixels, 'Reset original'); this.renderToolChecks();
  }
  async toggleEffect(id, enabled) {
    this.selectTool(id);
    if (id === 'atlas') {
      if (enabled) await this.buildAtlas(); else { this.atlasMode = false; this.el.dataset.atlas = 'false'; this.renderStage(); }
      this.renderToolChecks(); return;
    }
    if (id === 'crop' && enabled && !this.crop && !this.effects.some(effect => effect.id === 'crop' && effect.params?.rect)) {
      this.cropPending = true; this.cropping = true; this.renderToolChecks(); return;
    }
    if (id === 'crop' && !enabled) this.cropPending = false;
    return this.updateEffect(id, enabled);
  }
  async updateEffect(id, enabled, record = true) {
    if (!this.current()) return;
    if (id === 'resize' && (!Number.isInteger(Number(this.q('resize-width').value)) || !Number.isInteger(Number(this.q('resize-height').value)) || Number(this.q('resize-width').value) < 1 || Number(this.q('resize-height').value) < 1) && !record) return;
    const previous = this.cloneEffects();
    const existing = this.effects.find(effect => effect.id === id);
    const wasEnabled = existing?.enabled;
    const params = existing && (!enabled || (id === 'crop' && !this.crop)) ? existing.params : this.effectParams(id);
    if (existing) { existing.enabled = enabled; existing.params = params; }
    else this.effects.push({ id, enabled, params });
    try {
      const pixels = applyImageEffects(this.originalPixels, this.pixelEffects());
      const mask = this.effects.find(effect => effect.id === 'alpha-mask'); this.maskMode = mask?.enabled ? mask.params.mode : 'off';
      if (record) {
        const label = id === 'loop-texture' && wasEnabled && enabled
          ? `Loop texture ${params.size} × ${params.size}, ${params.blend}% blend`
          : id === 'rotate' && enabled
            ? `Rotate ${params.angle > 0 ? '+' : ''}${params.angle}°`
          : (enabled ? 'Enable ' : 'Disable ') + (imageToolDefinitions.find(([name]) => name === id)?.[1] || id);
        this.push(pixels, label);
      }
      else { this.previewPixels = pixels; this.renderToolChecks(); this.renderHistory(); this.renderStage(); this.changed(this.dirty); }
    } catch (error) { this.effects = previous; this.renderToolChecks(); throw error; }
  }
  async applyTool() { return this.toggleEffect(this.tool, true); }
  key(event) {
    if (!this.current()) return false;
    if (event.key === 'Escape' && this.mode === 'viewer') { event.preventDefault(); void this.setMode('editor').catch(error => this.message(error.message)); return true; }
    const target = event.target;
    const editingText = target?.isContentEditable || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || (target?.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(target.type));
    if (editingText || document.querySelector('dialog[open]')) return false;
    if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (!this.keyboardNavigationPending) {
        const inBrowser = Boolean(target?.closest('[data-role="browser-scroll"]'));
        const inRibbon = Boolean(target?.closest('[data-role="ribbon-list"]'));
        const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        void this.navigateImage(direction, { inBrowser, inRibbon }).catch(error => this.message(error.message));
      }
      return true;
    }
    if (this.mode !== 'editor' || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      void this.command(key === 'y' || event.shiftKey ? 'redo' : 'undo').catch(error => this.message(error.message));
      return true;
    }
    return false;
  }
  async navigateImage(direction, { inBrowser, inRibbon }) {
    const browser = inBrowser ? this.browser : this.documentBrowser;
    const query = inBrowser ? this.q('search').value.trim().toLocaleLowerCase() : '';
    const entries = browser?.entries.filter(entry => !entry.directory && (!query || entry.name.toLocaleLowerCase().includes(query))) || [];
    const sameFolder = browser && this.documentBrowser && this.treeKey(browser.folder) === this.treeKey(this.documentBrowser.folder);
    const index = sameFolder ? entries.findIndex(entry => entry.name.toLocaleLowerCase() === this.name.toLocaleLowerCase()) : -1;
    const next = index < 0 ? (direction > 0 ? entries[0] : entries.at(-1)) : entries[index + direction];
    if (!next) return;
    this.keyboardNavigationPending = true;
    try {
      await this.selectFile(next.relative, browser.sessionId);
      if (this.relative !== next.relative || this.sessionId !== browser.sessionId) return;
      const current = inBrowser ? this.q('browser-list').querySelector('.image-file-row.is-current') : this.q('ribbon-list').querySelector('.image-ribbon-item.is-current');
      if (inBrowser) current?.querySelector('.image-file-open')?.focus({ preventScroll: true });
      else if (inRibbon) current?.focus({ preventScroll: true });
      if (inBrowser || inRibbon || this.mode === 'viewer') current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } finally { this.keyboardNavigationPending = false; }
  }
  installBrowserDivider() {
    const divider = this.el.querySelector('.image-browser-divider'), layout = this.el.querySelector('.image-editor-layout');
    const saved = Number(localStorage.getItem('cationmedia:image-browser-width'));
    if (Number.isFinite(saved) && saved >= 260 && saved <= 460) layout.style.setProperty('--image-browser-width', saved + 'px');
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); divider.setPointerCapture(event.pointerId); divider.classList.add('is-resizing');
      const start = event.clientX, width = this.el.querySelector('.image-browser').getBoundingClientRect().width;
      const move = moveEvent => {
        const maximum = layout.clientWidth - this.el.querySelector('.image-inspector').getBoundingClientRect().width - 332;
        const next = Math.max(260, Math.min(460, maximum, Math.round(width + moveEvent.clientX - start)));
        layout.style.setProperty('--image-browser-width', next + 'px'); this.layoutCanvas();
      };
      const end = () => {
        divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', end); divider.removeEventListener('pointercancel', end);
        divider.classList.remove('is-resizing'); localStorage.setItem('cationmedia:image-browser-width', String(Math.round(this.el.querySelector('.image-browser').getBoundingClientRect().width)));
      };
      divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end);
    });
    divider.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault(); const width = this.el.querySelector('.image-browser').getBoundingClientRect().width + (event.key === 'ArrowRight' ? 16 : -16);
      const maximum = layout.clientWidth - this.el.querySelector('.image-inspector').getBoundingClientRect().width - 332;
      const next = Math.max(260, Math.min(460, maximum, Math.round(event.key === 'Home' ? 316 : width))); layout.style.setProperty('--image-browser-width', next + 'px'); localStorage.setItem('cationmedia:image-browser-width', String(next));
    });
  }
  limitBrowserWidth() {
    const layout = this.el.querySelector('.image-editor-layout'), browser = this.el.querySelector('.image-browser');
    if (this.mode !== 'editor' || !layout.clientWidth || getComputedStyle(browser).position === 'absolute') return;
    const inspectorWidth = this.el.querySelector('.image-inspector').getBoundingClientRect().width;
    const maximum = Math.max(260, Math.min(460, layout.clientWidth - inspectorWidth - 332));
    if (browser.getBoundingClientRect().width > maximum) layout.style.setProperty('--image-browser-width', maximum + 'px');
  }
  limitInspectorWidth() {
    const layout = this.el.querySelector('.image-editor-layout'), inspector = this.el.querySelector('.image-inspector');
    if (this.mode !== 'editor' || !layout.clientWidth || !inspector.clientWidth || window.innerWidth <= 760) return;
    const browser = this.el.querySelector('.image-browser');
    const browserWidth = getComputedStyle(browser).position === 'absolute' ? 0 : browser.getBoundingClientRect().width;
    const maximum = Math.max(260, Math.min(620, layout.clientWidth - browserWidth - (browserWidth ? 332 : 326)));
    if (inspector.getBoundingClientRect().width > maximum) layout.style.setProperty('--image-inspector-width', maximum + 'px');
  }
  limitInspectorHeights() {
    const inspector = this.el.querySelector('.image-inspector');
    if (this.mode !== 'editor' || !inspector.clientHeight || window.innerWidth <= 760) return;
    const list = inspector.querySelector('.image-tool-list'), history = inspector.querySelector('.image-history');
    const available = inspector.clientHeight - inspector.querySelector('.image-tool-head').offsetHeight - inspector.querySelector('.image-apply-bar').offsetHeight - 12 - 74;
    const listHeight = Math.min(list.getBoundingClientRect().height, Math.max(80, available - 80));
    const historyHeight = Math.min(history.getBoundingClientRect().height, Math.max(80, available - listHeight));
    if (list.getBoundingClientRect().height > listHeight) inspector.style.setProperty('--image-tool-list-height', Math.round(listHeight) + 'px');
    if (history.getBoundingClientRect().height > historyHeight) inspector.style.setProperty('--image-history-height', Math.round(historyHeight) + 'px');
  }
  installInspectorDividers() {
    const layout = this.el.querySelector('.image-editor-layout'), inspector = this.el.querySelector('.image-inspector');
    const widthDivider = this.el.querySelector('.image-inspector-divider');
    const widthKey = 'cationmedia:image-inspector-width';
    const widthSaved = Number(localStorage.getItem(widthKey));
    if (Number.isFinite(widthSaved) && widthSaved >= 260 && widthSaved <= 620) layout.style.setProperty('--image-inspector-width', widthSaved + 'px');
    const setWidth = width => {
      const browser = this.el.querySelector('.image-browser');
      const browserWidth = getComputedStyle(browser).position === 'absolute' ? 0 : browser.getBoundingClientRect().width;
      const maximum = Math.max(260, Math.min(620, layout.clientWidth - browserWidth - (browserWidth ? 332 : 326)));
      const next = Math.max(260, Math.min(maximum, Math.round(width)));
      layout.style.setProperty('--image-inspector-width', next + 'px'); this.layoutCanvas(); return next;
    };
    widthDivider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); widthDivider.setPointerCapture(event.pointerId); widthDivider.classList.add('is-resizing');
      const start = event.clientX, width = inspector.getBoundingClientRect().width;
      const move = moved => setWidth(width + start - moved.clientX);
      const end = () => {
        widthDivider.removeEventListener('pointermove', move); widthDivider.removeEventListener('pointerup', end); widthDivider.removeEventListener('pointercancel', end);
        widthDivider.classList.remove('is-resizing'); localStorage.setItem(widthKey, String(Math.round(inspector.getBoundingClientRect().width)));
      };
      widthDivider.addEventListener('pointermove', move); widthDivider.addEventListener('pointerup', end); widthDivider.addEventListener('pointercancel', end);
    });
    widthDivider.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault(); localStorage.setItem(widthKey, String(setWidth(event.key === 'Home' ? 320 : inspector.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 16 : -16))));
    });
    for (const kind of ['tools', 'history']) {
      const divider = inspector.querySelector(`[data-resize-panel="${kind}"]`);
      const element = inspector.querySelector(kind === 'tools' ? '.image-tool-list' : '.image-history');
      const other = inspector.querySelector(kind === 'tools' ? '.image-history' : '.image-tool-list');
      const variable = kind === 'tools' ? '--image-tool-list-height' : '--image-history-height';
      const key = `cationmedia:image-${kind}-height`;
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved >= 80) inspector.style.setProperty(variable, saved + 'px');
      const setHeight = height => {
        const available = inspector.clientHeight - inspector.querySelector('.image-tool-head').offsetHeight - inspector.querySelector('.image-apply-bar').offsetHeight - 12 - 74 - other.getBoundingClientRect().height;
        const next = Math.max(80, Math.min(Math.max(80, available), Math.round(height)));
        inspector.style.setProperty(variable, next + 'px'); return next;
      };
      divider.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); divider.setPointerCapture(event.pointerId); divider.classList.add('is-resizing');
        const start = event.clientY, height = element.getBoundingClientRect().height;
        const move = moved => setHeight(height + (kind === 'tools' ? 1 : -1) * (moved.clientY - start));
        const end = () => {
          divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', end); divider.removeEventListener('pointercancel', end);
          divider.classList.remove('is-resizing'); localStorage.setItem(key, String(Math.round(element.getBoundingClientRect().height)));
        };
        divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end);
      });
      divider.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault(); const delta = (event.key === 'ArrowDown' ? 16 : -16) * (kind === 'tools' ? 1 : -1);
        localStorage.setItem(key, String(setHeight(event.key === 'Home' ? (kind === 'tools' ? 260 : 180) : element.getBoundingClientRect().height + delta)));
      });
    }
    this.limitInspectorWidth(); this.limitInspectorHeights();
  }
  async contextMenu(event) {
    if (!window.desktop?.imageContextMenu) return;
    if (event.target.closest('.image-entry-rename')) return;
    event.preventDefault();
    const row = event.target.closest('.image-file-row, .image-tree-item');
    const treeFolder = row?.classList.contains('image-tree-item') && (row.dataset.imageLocation || row.dataset.browseRelative !== undefined);
    const entry = treeFolder ? { name: row.dataset.entryName, relative: row.dataset.browseRelative, sessionId: row.dataset.browseSession, locationId: row.dataset.imageLocation, directory: true }
      : row?.classList.contains('image-file-row') && this.browser?.entries.find(item => item.relative === row.dataset.relative) || null;
    const context = entry ? 'file' : event.target.closest('.image-browser') ? 'browser' : 'stage';
    const action = await window.desktop.imageContextMenu({
      context, mode: this.mode, hasImage: Boolean(this.current()), hasBrowser: Boolean(this.browser), canUp: Boolean(this.browser && this.treeKey(this.browser.folder) !== this.treeKey(this.browser.volumeRoot)),
      imageCount: this.browser?.entries.filter(item => !item.directory).length || 0, grid: this.q('browser-list').classList.contains('is-grid'),
      atlasReady: Boolean(this.atlas), tool: this.tool, activeTools: [...this.effects.filter(effect => effect.enabled).map(effect => effect.id), ...(this.atlasMode ? ['atlas'] : [])], undo: this.index > 0 || this.hasAdjustments(), redo: this.index < this.history.length - 1,
      entry: entry && { directory: entry.directory, selected: this.selection.has(entry.relative), renamable: Boolean(entry.sessionId || !entry.directory && this.browser?.sessionId) && Boolean(entry.relative) && !entry.locationId }
    });
    if (!action) return;
    if (action === 'open-entry' && entry) return entry.locationId ? this.openLocation(entry.locationId) : entry.directory ? this.browse(entry.relative, entry.sessionId) : this.selectFile(entry.relative);
    if (action === 'select-entry' && entry && !entry.directory) { if (this.selection.has(entry.relative)) this.selection.delete(entry.relative); else this.selection.add(entry.relative); return this.updateSelected(); }
    if (action === 'copy-name' && entry) { const name = await window.desktop.imageCopyName(entry.sessionId || this.browser.sessionId, entry.relative); return this.message('Copied name: ' + name); }
    if (action === 'rename-entry' && entry) return this.beginRename(entry, row);
    if (action.startsWith('tool:')) { const id = action.slice(5); return id === 'rotate' ? this.selectTool(id) : this.toggleEffect(id, !this.effectEnabled(id)); }
    if (action.startsWith('mode:')) return this.setMode(action.slice(5));
    return this.command(action);
  }
  beginRename(entry, row) {
    if (!row?.isConnected || !window.desktop?.imageRename || !entry.relative || entry.locationId) return;
    const target = row.classList.contains('image-file-row') ? row.querySelector('.image-file-open') : row;
    if (!target || row.querySelector('.image-entry-rename')) return;
    const input = document.createElement('input'); input.type = 'text'; input.className = 'image-entry-rename';
    input.value = entry.name; input.setAttribute('aria-label', 'Rename ' + entry.name);
    const button = row.classList.contains('image-tree-item') ? row : null;
    if (button) button.hidden = true; else target.hidden = true;
    (button ? row.parentElement : row).append(input);
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('pointerdown', event => event.stopPropagation());
    let finished = false;
    const close = () => { input.remove(); if (button) button.hidden = false; else target.hidden = false; };
    const finish = async commit => {
      if (finished) return;
      finished = true;
      if (!commit || input.value === entry.name) { close(); return; }
      try {
        const result = await window.desktop.imageRename(entry.sessionId || this.browser.sessionId, entry.relative, input.value, {
          browserSessionId: this.browser?.sessionId, browserRelative: this.browser?.relative, documentId: this.documentId
        });
        close(); this.applyRename(result);
      } catch (error) { finished = false; this.message(error.message); input.focus(); input.select(); }
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
    });
    input.addEventListener('blur', () => { void finish(true); });
    input.focus();
    const stem = !entry.directory ? entry.name.lastIndexOf('.') : -1;
    input.setSelectionRange(0, stem > 0 ? stem : entry.name.length);
  }
  applyRename(result) {
    if (result.directory) {
      const previous = 'path:' + this.treeKey(result.oldFolder), next = 'path:' + this.treeKey(result.newFolder);
      this.treeExpanded = new Set([...this.treeExpanded].map(id => id === previous || id.startsWith(previous + '\\') ? next + id.slice(previous.length) : id));
    } else if (this.selection.delete(result.oldRelative)) this.selection.add(result.newRelative);
    if (result.directory) { this.treeCache.clear(); this.lastTreeSelection = null; }
    if (result.document) {
      this.name = result.document.name; this.relative = result.document.relative; this.sessionId = result.document.sessionId;
      this.documentBrowser = result.document.browser;
    }
    if (result.browser) this.setBrowser(result.browser);
    else { this.renderBrowser(); this.renderTree(); }
    if (result.document) { this.renderRibbon(); this.renderStage(); this.changed(this.dirty); }
    this.message('Renamed to ' + result.name + '.');
  }
  treeKey(folder) { return String(folder || '').replace(/\//g, '\\').replace(/\\+$/, '').toLocaleLowerCase() || '\\'; }
  sameFolderContents(previous, next) {
    if (!previous || !next || this.treeKey(previous.folder) !== this.treeKey(next.folder) || previous.entries.length !== next.entries.length) return false;
    // The tree and document can describe the same folder through different session roots.
    // Keep each existing view's session-relative paths when its displayed entries are unchanged.
    return previous.entries.every((entry, index) => {
      const other = next.entries[index];
      return entry.name === other.name && entry.directory === other.directory && entry.size === other.size;
    });
  }
  treeFolder(root, relative = '') {
    if (!relative) return root;
    const separator = root.includes('\\') ? '\\' : '/';
    return root.replace(/[\\/]+$/, '') + separator + relative.replace(/[\\/]/g, separator);
  }
  expandCurrentPath(browser) {
    this.treeExpanded.add('desktop-root');
    this.treeExpanded.add('computer');
    const segments = browser.relative ? browser.relative.split(/[\\/]/) : [];
    const separator = browser.root.includes('\\') ? '\\' : '/';
    for (let depth = 0; depth < segments.length; depth++) {
      const folder = this.treeFolder(browser.root, segments.slice(0, depth).join(separator));
      this.treeExpanded.add('path:' + this.treeKey(folder));
    }
  }
  async refreshTree(browser, { reveal = true } = {}) {
    if (!window.desktop?.imageLocations) return;
    const revision = ++this.treeRevision;
    const locationsPromise = this.locations.length ? Promise.resolve(this.locations) : window.desktop.imageLocations();
    const segments = browser.relative ? browser.relative.split(/[\\/]/) : [];
    const separator = browser.root.includes('\\') ? '\\' : '/';
    const primed = browser.root === browser.volumeRoot && this.treeReadySession === browser.sessionId &&
      Array.from({ length: segments.length + 1 }, (_, depth) => this.treeKey(this.treeFolder(browser.root, segments.slice(0, depth).join(separator)))).every(key => this.treeCache.has(key));
    const context = primed || !window.desktop.imageTreeContext ? { browser, branches: [browser] } : await window.desktop.imageTreeContext(browser.sessionId, browser.relative);
    const locations = await locationsPromise;
    if (revision !== this.treeRevision) return;
    this.locations = locations; this.browser = context.browser; this.treeReadySession = context.browser.sessionId;
    for (const branch of context.branches) this.treeCache.set(this.treeKey(branch.folder), branch);
    this.expandCurrentPath(context.browser); this.renderBrowser(); this.renderTree({ reveal });
  }
  setBrowser(browser, { expandSelected = true, reveal = true } = {}) {
    if (!browser) return;
    if (this.browser?.folder !== browser.folder) { this.selection.clear(); this.selectionAnchor = null; this.q('search').value = ''; }
    if (expandSelected) this.treeExpanded.add('path:' + this.treeKey(browser.folder));
    this.browser = browser; this.treeCache.set(this.treeKey(browser.folder), browser);
    this.renderBrowser(); this.renderTree({ reveal });
    void this.refreshTree(browser, { reveal }).catch(error => this.message(error.message));
  }
  async browse(relative, sessionId = this.browser?.sessionId, options) {
    if (!window.desktop?.imageBrowse || !sessionId) return;
    this.setBrowser(await window.desktop.imageBrowse(sessionId, relative), options);
  }
  async chooseFolder() {
    if (!window.desktop?.imageChooseFolder) return this.message('Folder browsing is available in the desktop app.');
    this.setBrowser(await window.desktop.imageChooseFolder());
  }
  async showLocations() {
    if (!window.desktop?.imageLocations) return this.message('File locations are available in the desktop app.');
    if (!this.locations.length) this.locations = await window.desktop.imageLocations();
    this.treeExpanded.add('desktop-root'); this.treeExpanded.add('computer'); this.renderTree();
    this.q('browser-tree').querySelector('[data-tree-expand="computer"]')?.scrollIntoView({ block: 'nearest' });
  }
  async openLocation(id, options) {
    if (!window.desktop?.imageOpenLocation) return;
    this.setBrowser(await window.desktop.imageOpenLocation(id), options);
  }
  async browseAncestor(levels) {
    if (!this.browser || !levels) return;
    if (!window.desktop?.imageAncestor) return this.message('Parent navigation is available in the desktop app.');
    const browser = await window.desktop.imageAncestor(this.browser.sessionId, this.browser.relative, levels);
    if (!browser) return this.showLocations();
    this.setBrowser(browser);
  }
  async activateTreeFolder(folder) {
    const { browseRelative, browseSession, imageLocation, treeExpand } = folder.dataset;
    const expand = treeExpand || folder.closest('.image-tree-line')?.querySelector('.image-tree-expand[data-tree-expand]')?.dataset.treeExpand;
    if (expand) await this.toggleTree(expand);
    const options = { expandSelected: !expand, reveal: false };
    if (browseRelative !== undefined) return this.browse(browseRelative, browseSession, options);
    if (imageLocation) return this.openLocation(imageLocation, { ...options, expandSelected: !expand || expand.startsWith('shortcut:') });
  }
  async toggleTree(id) {
    if (this.treeExpanded.has(id)) { this.treeExpanded.delete(id); this.renderTree(); return; }
    if (id !== 'computer' && id !== 'desktop-root') {
      const node = this.treeNodes.get(id);
      if (!node) return;
      if (!this.treeCache.has(node.branchKey)) {
        const branch = node.locationId ? await window.desktop.imageTreeLocation(node.locationId) : await window.desktop.imageTreeBranch(node.sessionId, node.relative);
        this.treeCache.set(node.branchKey, branch);
      }
    }
    this.treeExpanded.add(id);
    this.renderTree();
  }
  async selectFile(relative, sessionId = this.browser?.sessionId) {
    if (!window.desktop?.imageOpenEntry) return;
    const descriptor = await window.desktop.imageOpenEntry(sessionId, relative);
    descriptor.preferredMode = this.mode;
    await this.open(descriptor);
  }
  makeThumb(entry, sessionId) {
    const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy';
    if (['tif', 'tiff'].includes(imageExtension(entry.name))) {
      image.dataset.session = sessionId; image.dataset.relative = entry.relative; this.thumbObserver.observe(image);
    } else image.src = entry.url;
    return image;
  }
  selectBrowserEntry(entry, event, checked) {
    const query = this.q('search').value.trim().toLocaleLowerCase();
    const entries = this.browser.entries.filter(item => !item.directory && (!query || item.name.toLocaleLowerCase().includes(query)));
    const additive = event.ctrlKey || event.metaKey;
    const current = this.documentBrowser && this.treeKey(this.browser.folder) === this.treeKey(this.documentBrowser.folder)
      ? entries.find(item => item.name.toLocaleLowerCase() === this.name.toLocaleLowerCase())?.relative : null;
    const anchor = this.selectionAnchor || current || entry.relative;
    if (event.shiftKey) {
      const from = entries.findIndex(item => item.relative === anchor), to = entries.findIndex(item => item.relative === entry.relative);
      if (!additive) this.selection.clear();
      for (const item of entries.slice(Math.min(from < 0 ? to : from, to), Math.max(from < 0 ? to : from, to) + 1)) this.selection.add(item.relative);
      this.selectionAnchor = from < 0 ? entry.relative : anchor;
    } else if (additive || checked !== undefined) {
      if (additive && checked === undefined && !this.selection.size && current && current !== entry.relative) this.selection.add(current);
      const select = checked ?? !this.selection.has(entry.relative);
      if (select) this.selection.add(entry.relative); else this.selection.delete(entry.relative);
      this.selectionAnchor = entry.relative;
    } else {
      this.selectionAnchor = entry.relative;
      return false;
    }
    this.updateSelected();
    return true;
  }
  renderBrowser() {
    const scroll = this.captureBrowserScroll();
    const list = this.q('browser-list');
    for (const thumbnail of list.querySelectorAll('img[data-session]')) this.thumbObserver.unobserve(thumbnail);
    list.replaceChildren();
    if (!this.browser) { this.updateSelected(); this.restoreBrowserScroll(scroll); return; }
    const query = this.q('search').value.trim().toLocaleLowerCase();
    const entries = this.browser.entries.filter(item => !item.directory && (!query || item.name.toLocaleLowerCase().includes(query)));
    for (const entry of entries) {
      const current = this.documentBrowser && this.treeKey(this.browser.folder) === this.treeKey(this.documentBrowser.folder) && entry.name.toLocaleLowerCase() === this.name.toLocaleLowerCase();
      const row = document.createElement('div'); row.className = 'image-file-row' + (current ? ' is-current' : '');
      row.dataset.relative = entry.relative; row.title = entry.name; row.draggable = true;
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = this.selection.has(entry.relative);
      check.setAttribute('aria-label', 'Select ' + entry.name + ' for atlas');
      check.onclick = event => this.selectBrowserEntry(entry, event, check.checked);
      const button = document.createElement('button'); button.className = 'image-file-open'; button.type = 'button';
      const thumbnail = this.makeThumb(entry, this.browser.sessionId); thumbnail.draggable = false; button.append(thumbnail);
      const details = document.createElement('span'); details.className = 'image-file-details';
      const name = document.createElement('strong'); name.textContent = entry.name; name.title = entry.name;
      const meta = document.createElement('small'); meta.textContent = labelSize(entry.size);
      details.append(name, meta); button.append(details);
      button.onclick = event => {
        if (!this.selectBrowserEntry(entry, event)) void this.selectFile(entry.relative).catch(error => this.message(error.message));
      };
      row.append(check, button); list.append(row);
    }
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'image-empty'; empty.textContent = 'No images in this folder.'; list.append(empty); }
    this.updateSelected();
    this.restoreBrowserScroll(scroll);
  }
  updateBrowserCurrent() {
    const sameFolder = this.browser && this.documentBrowser && this.treeKey(this.browser.folder) === this.treeKey(this.documentBrowser.folder);
    for (const row of this.q('browser-list').querySelectorAll('.image-file-row')) {
      row.classList.toggle('is-current', Boolean(sameFolder && row.title.toLocaleLowerCase() === this.name.toLocaleLowerCase()));
    }
  }
  captureBrowserScroll() {
    // Keep the clicked folder under the pointer when file rows above it change height.
    const scroll = this.q('browser-scroll'), bounds = scroll.getBoundingClientRect();
    const visible = row => { const rect = row.getBoundingClientRect(); return rect.height && rect.bottom > bounds.top && rect.top < bounds.bottom; };
    const focused = document.activeElement?.closest('.image-tree-line');
    const anchor = focused && scroll.contains(focused) && visible(focused) ? focused
      : [...scroll.querySelectorAll('.image-tree-line, .image-file-row')].find(visible);
    return { top: scroll.scrollTop, left: scroll.scrollLeft, anchor, offset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0 };
  }
  restoreBrowserScroll(state) {
    const scroll = this.q('browser-scroll');
    if (state.anchor?.isConnected && state.anchor.getClientRects().length) {
      scroll.scrollTop += state.anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - state.offset;
    } else scroll.scrollTop = state.top;
    scroll.scrollLeft = state.left;
  }
  renderTree({ reveal = false } = {}) {
    const tree = this.q('browser-tree'), list = this.q('browser-list');
    const scroll = this.captureBrowserScroll();
    const existing = new Map([...tree.querySelectorAll(':scope > .image-tree-line')].map(row => [row.dataset.treeRowKey, row]));
    const children = [];
    tree.style.removeProperty('--image-depth');
    this.treeNodes.clear();
    if (!this.locations.length) {
      list.hidden = false;
      this.q('browser-scroll').append(list);
      const loading = document.createElement('p'); loading.className = 'image-empty'; loading.textContent = 'Loading folders…'; tree.replaceChildren(loading); this.restoreBrowserScroll(scroll); return;
    }
    list.hidden = Boolean(this.browser);
    const selectedKey = this.browser ? this.treeKey(this.browser.folder) : null;
    let selectedRendered = false;
    const makeRow = (id, label, depth, branchKey, destination, selected = false, rowKey = id) => {
      selected = selected && !selectedRendered;
      if (selected) selectedRendered = true;
      const branch = this.treeCache.get(branchKey);
      const hasFolders = id === 'desktop-root' || id === 'computer' || !branch || branch.entries.some(item => item.directory);
      const hasContents = hasFolders || selected && this.browser?.entries.some(item => !item.directory);
      const row = existing.get(rowKey) || document.createElement('div'); row.className = 'image-tree-line' + (selected ? ' is-current' : '');
      row.dataset.treeRowKey = rowKey;
      row.style.setProperty('--image-depth', String(depth)); row.title = destination.folder || label;
      if (hasContents) {
        row.querySelector('.image-tree-expand-space')?.remove();
        const expand = row.querySelector('.image-tree-expand') || document.createElement('button'); expand.type = 'button'; expand.className = 'image-tree-expand';
        expand.dataset.treeExpand = id; expand.textContent = this.treeExpanded.has(id) ? '−' : '+';
        expand.setAttribute('aria-label', (this.treeExpanded.has(id) ? 'Collapse ' : 'Expand ') + label);
        expand.setAttribute('aria-expanded', String(this.treeExpanded.has(id))); if (!expand.parentElement) row.prepend(expand);
      } else {
        row.querySelector('.image-tree-expand')?.remove();
        if (!row.querySelector('.image-tree-expand-space')) { const spacer = document.createElement('span'); spacer.className = 'image-tree-expand-space'; row.prepend(spacer); }
      }
      const target = row.querySelector('.image-tree-item') || document.createElement('button'); target.type = 'button'; target.className = 'image-tree-item';
      if (id === 'computer' || id === 'desktop-root') target.dataset.treeExpand = id;
      else if (destination.locationId) target.dataset.imageLocation = destination.locationId;
      else { target.dataset.browseRelative = destination.relative; target.dataset.browseSession = destination.sessionId; }
      const icon = target.querySelector('.image-tree-folder') || document.createElement('span'); icon.className = 'image-tree-folder';
      const iconMarkup = imageIcon(destination.icon || (hasContents && this.treeExpanded.has(id) ? imageUiIcons.folderOpen : imageUiIcons.folder));
      if (icon.innerHTML !== iconMarkup) icon.innerHTML = iconMarkup;
      const text = target.lastElementChild && target.lastElementChild !== icon ? target.lastElementChild : document.createElement('span');
      if (text.textContent !== label) text.textContent = label;
      target.dataset.entryName = label;
      if (!icon.parentElement) target.append(icon, text);
      if (!target.parentElement) row.append(target);
      children.push(row);
      if (selected && (!hasContents || this.treeExpanded.has(id))) {
        tree.style.setProperty('--image-depth', String(depth + 1));
        list.hidden = false; children.push(list);
      }
      this.treeNodes.set(id, { ...destination, branchKey });
      return branch;
    };
    const renderChildren = (branch, depth, ancestors, parentKey) => {
      if (depth > 32) return;
      for (const entry of branch.entries) {
        if (!entry.directory) continue;
        const key = this.treeKey(this.treeFolder(branch.root, entry.relative));
        const id = 'path:' + key;
        const rowKey = parentKey + '/' + id;
        const child = makeRow(id, entry.name, depth, key, { sessionId: branch.sessionId, relative: entry.relative, folder: this.treeFolder(branch.root, entry.relative) }, selectedKey === key, rowKey);
        if (child && this.treeExpanded.has(id) && !ancestors.has(key)) renderChildren(child, depth + 1, new Set([...ancestors, key]), rowKey);
      }
    };
    makeRow('desktop-root', 'Desktop', 0, '', { icon: imageUiIcons.desktop });
    if (this.treeExpanded.has('desktop-root')) {
      for (const location of this.locations.filter(item => item.kind !== 'drive')) {
        const key = this.treeKey(location.folder), id = 'shortcut:' + location.id;
        const branch = makeRow(id, location.name, 1, key, { locationId: location.id, folder: location.folder, icon: imageUiIcons[location.id] }, selectedKey === key && this.treeExpanded.has(id));
        if (branch && this.treeExpanded.has(id)) renderChildren(branch, 2, new Set([key]), id);
      }
      makeRow('computer', 'This PC', 1, '', { icon: imageUiIcons.computer });
      if (this.treeExpanded.has('computer')) for (const location of this.locations.filter(item => item.kind === 'drive')) {
        const key = this.treeKey(location.folder), id = 'path:' + key;
        const branch = makeRow(id, location.name, 2, key, { locationId: location.id, folder: location.folder, icon: imageUiIcons.drive }, selectedKey === key);
        if (branch && this.treeExpanded.has(id)) renderChildren(branch, 3, new Set([key]), id);
      }
    }
    if (!children.includes(list)) this.q('browser-scroll').append(list);
    const retained = new Set(children);
    for (const child of [...tree.children]) if (!retained.has(child)) child.remove();
    let next = tree.firstElementChild;
    for (const child of children) {
      if (child !== next) tree.insertBefore(child, next);
      next = child.nextElementSibling;
    }
    if (this.browser && !selectedRendered) list.hidden = false;
    this.restoreBrowserScroll(scroll);
    if (reveal && selectedKey && selectedKey !== this.lastTreeSelection && this.mode === 'editor') this.scrollCurrentTreeFolder();
    else if (!reveal && selectedRendered) this.lastTreeSelection = selectedKey;
  }
  scrollCurrentTreeFolder() {
    const selectedKey = this.browser ? this.treeKey(this.browser.folder) : null;
    // Installing another image reapplies the mode; keep the user's position in the same folder.
    if (selectedKey === this.lastTreeSelection) return;
    const current = this.q('browser-tree').querySelector('.image-tree-line.is-current');
    if (!current || !current.getClientRects().length) return;
    current.scrollIntoView({ block: 'start' });
    this.lastTreeSelection = selectedKey;
  }
  updateSelected() {
    this.q('selected-count').textContent = this.selection.size + ' selected';
    for (const row of this.q('browser-list').querySelectorAll('.image-file-row')) {
      const selected = this.selection.has(row.dataset.relative);
      row.classList.toggle('is-selected', selected);
      row.querySelector('input').checked = selected;
      row.querySelector('.image-file-open').setAttribute('aria-pressed', String(selected));
    }
  }
  renderRibbon() {
    const list = this.q('ribbon-list');
    const scrollLeft = list.scrollLeft;
    for (const thumbnail of list.querySelectorAll('img[data-session]')) this.thumbObserver.unobserve(thumbnail);
    list.replaceChildren();
    if (!this.documentBrowser) { this.updateRibbonScrollbar(); return; }
    for (const entry of this.documentBrowser.entries) {
      if (entry.directory || !isImage(entry.name)) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'image-ribbon-item'; button.dataset.name = entry.name;
      button.dataset.relative = entry.relative; button.draggable = true;
      const thumbnail = this.makeThumb(entry, this.documentBrowser.sessionId); thumbnail.draggable = false; button.append(thumbnail);
      const label = document.createElement('span'); label.textContent = entry.name; button.append(label);
      button.onclick = () => { void this.selectFile(entry.relative, this.documentBrowser.sessionId).catch(error => this.message(error.message)); };
      list.append(button);
    }
    list.scrollLeft = scrollLeft;
    this.updateRibbonCurrent();
  }
  updateRibbonCurrent() {
    const list = this.q('ribbon-list');
    for (const button of list.querySelectorAll('.image-ribbon-item')) {
      button.classList.toggle('is-current', button.dataset.name.toLocaleLowerCase() === this.name.toLocaleLowerCase());
    }
    list.querySelector('.is-current')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    this.updateRibbonScrollbar();
  }
  updateRibbonScrollbar() {
    const list = this.q('ribbon-list'), track = this.q('ribbon-scrollbar'), thumb = this.q('ribbon-scrollbar-thumb');
    const maxScroll = list.scrollWidth - list.clientWidth;
    track.hidden = maxScroll <= 1 || list.clientWidth === 0;
    if (track.hidden) return;
    const trackWidth = track.clientWidth;
    const thumbWidth = Math.max(28, Math.min(trackWidth, trackWidth * list.clientWidth / list.scrollWidth));
    thumb.style.width = thumbWidth + 'px';
    thumb.style.transform = `translateX(${list.scrollLeft / maxScroll * (trackWidth - thumbWidth)}px)`;
    track.setAttribute('aria-valuenow', String(Math.round(list.scrollLeft / maxScroll * 100)));
  }
  dragRibbonScrollbar(event) {
    if (event.button !== 0) return;
    const list = this.q('ribbon-list'), track = this.q('ribbon-scrollbar'), thumb = this.q('ribbon-scrollbar-thumb');
    const trackRect = track.getBoundingClientRect(), thumbRect = thumb.getBoundingClientRect();
    const grabOffset = event.target === thumb ? event.clientX - thumbRect.left : thumbRect.width / 2;
    track.focus({ preventScroll: true });
    const scrollToPointer = clientX => {
      const travel = trackRect.width - thumbRect.width;
      if (travel <= 0) return;
      const position = Math.max(0, Math.min(travel, clientX - trackRect.left - grabOffset));
      list.scrollLeft = position / travel * (list.scrollWidth - list.clientWidth);
    };
    scrollToPointer(event.clientX);
    track.setPointerCapture(event.pointerId);
    track.onpointermove = move => scrollToPointer(move.clientX);
    track.onpointerup = track.onpointercancel = () => {
      track.onpointermove = track.onpointerup = track.onpointercancel = null;
    };
    event.preventDefault();
  }
  async maybeLeave() {
    if (!this.dirty) return true;
    if (!window.desktop?.confirmImageDiscard) return window.confirm('Discard unsaved image edits?');
    const choice = await window.desktop.confirmImageDiscard();
    if (choice === 2) return false;
    if (choice === 0) return Boolean(await this.save());
    return true;
  }
  exportData(format) {
    const canvas = dataCanvas(this.current());
    if (['jpg', 'bmp'].includes(format)) {
      const matte = document.createElement('canvas'); matte.width = canvas.width; matte.height = canvas.height;
      const context = matte.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, matte.width, matte.height); context.drawImage(canvas, 0, 0);
      canvas.width = matte.width; canvas.height = matte.height; canvas.getContext('2d').drawImage(matte, 0, 0);
    }
    return canvas.toDataURL('image/png');
  }
  needsTransparentPng() {
    if (!['jpg', 'jpeg', 'bmp'].includes(imageExtension(this.name))) return false;
    const data = this.current()?.data;
    for (let index = 3; index < (data?.length || 0); index += 4) if (data[index] < 255) return true;
    return false;
  }
  async save() {
    if (!this.current()) return null;
    if (this.atlasMode) return this.saveAtlas();
    this.commitAdjustments();
    if (this.needsTransparentPng()) {
      this.message('This image has transparency. Choose where to save the PNG copy.');
      return this.saveAs('png');
    }
    if (!window.desktop?.imageSaveChanges) throw new Error('Image saving is available in the desktop app.');
    const saved = await window.desktop.imageSaveChanges(this.documentId, { data: this.exportData(imageExtension(this.name) === 'jpeg' ? 'jpg' : imageExtension(this.name)) });
    if (saved) { this.savedIndex = this.index; this.changed(this.dirty); this.renderStage(); this.message('Saved ' + saved.name + '.'); }
    return saved;
  }
  async saveAs(requestedFormat) {
    if (!this.current()) return null;
    if (this.atlasMode) return this.saveAtlas(requestedFormat || 'png');
    if (!window.desktop?.saveImage) throw new Error('Image export is available in the desktop app.');
    this.commitAdjustments();
    const extension = requestedFormat || (this.needsTransparentPng() ? 'png' : imageExtension(this.name));
    const format = extension === 'jpeg' ? 'jpg' : extension === 'tif' ? 'tiff' : extension;
    if (!imageExportFormats.includes(format)) throw new Error('Choose an export format.');
    const saved = await window.desktop.saveImage(this.documentId, { format, data: this.exportData(format) });
    if (saved) {
      this.savedIndex = this.index; this.name = saved.name; this.relative = saved.relative; this.sessionId = saved.sessionId;
      this.documentBrowser = saved.browser; this.setBrowser(saved.browser);
      this.animated = false; this.q('animation').removeAttribute('src');
      this.renderRibbon(); this.renderStage(); this.changed(this.dirty); this.message('Saved as ' + saved.name + '.');
    }
    return saved;
  }
  async buildAtlas() {
    if (!this.browser || !window.desktop?.imageRead) throw new Error('Open a local image folder first.');
    const selected = this.browser.entries.filter(item => !item.directory && this.selection.has(item.relative));
    if (!selected.length) throw new Error('Select images in the current folder for the atlas.');
    if (selected.length > 256) throw new Error('Select at most 256 images for one atlas.');
    const images = [];
    let totalPixels = 0;
    for (const entry of selected) {
      const source = await window.desktop.imageRead(this.browser.sessionId, entry.relative);
      const pixels = await staticPixels(source, imageExtension(entry.name));
      totalPixels += pixels.width * pixels.height;
      if (totalPixels > 64_000_000) throw new Error('Selected images exceed the atlas pixel limit.');
      images.push({ entry, pixels });
    }
    const layout = packAtlas(images.map(({ entry, pixels }) => ({ id: entry.relative, width: pixels.width, height: pixels.height })), {
      mode: this.q('atlas-mode').value, autoSize: this.q('atlas-auto-size').checked, maxWidth: Number(this.q('atlas-width').value), maxHeight: Number(this.q('atlas-height').value), padding: Number(this.q('atlas-padding').value)
    });
    const canvas = document.createElement('canvas'); canvas.width = layout.width; canvas.height = layout.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    for (const placement of layout.placements) {
      const item = images.find(image => image.entry.relative === placement.id);
      context.drawImage(dataCanvas(item.pixels), placement.x, placement.y);
    }
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    this.atlas = { pixels: { width: canvas.width, height: canvas.height, data: data.data }, frames: layout.placements.map(({ id, x, y, width, height }) => ({ relative: id, x, y, width, height })), sessionId: this.browser.sessionId };
    this.atlasMode = true; this.el.dataset.atlas = 'true'; this.renderStage();
    this.message('Atlas preview: ' + layout.width + ' × ' + layout.height + ', ' + images.length + ' images.');
  }
  async saveAtlas(format = 'png') {
    if (!this.atlas) throw new Error('Build an atlas preview first.');
    if (!['png', 'webp'].includes(format)) throw new Error('Atlas export supports PNG or WebP.');
    const saved = await window.desktop.saveImageAtlas(this.atlas.sessionId, { format, data: dataCanvas(this.atlas.pixels).toDataURL('image/png'), width: this.atlas.pixels.width, height: this.atlas.pixels.height, frames: this.atlas.frames });
    if (saved) this.message('Saved ' + saved.name + ' and ' + saved.metadata + '.');
  }
  async command(action) {
    if (action === 'choose-folder') return this.chooseFolder();
    if (action === 'locations') return this.showLocations();
    if (action === 'toggle-browser') {
      const open = this.el.dataset.browserOpen !== 'true'; this.el.dataset.browserOpen = String(open);
      this.el.querySelector('.image-browser-toggle').setAttribute('aria-expanded', String(open)); return;
    }
    if (action === 'up') {
      return this.browseAncestor(1);
    }
    if (action === 'select-all') { for (const entry of this.browser?.entries || []) if (!entry.directory) this.selection.add(entry.relative); return this.updateSelected(); }
    if (action === 'view') {
      const grid = this.q('browser-list').classList.toggle('is-grid');
      const button = this.el.querySelector('[data-image-action="view"]');
      button.innerHTML = imageIcon(grid ? imageUiIcons.list : imageUiIcons.grid);
      button.title = grid ? 'List view' : 'Thumbnail view'; button.setAttribute('aria-label', button.title);
      return;
    }
    if (action === 'atlas') return this.selectTool('atlas');
    if (action === 'build-atlas') { this.selectTool('atlas'); return this.applyTool(); }
    if (action === 'save-atlas') return this.saveAtlas();
    if (action === 'save') return this.save();
    if (action === 'save-as') return this.saveAs();
    if (action.startsWith('convert:')) return this.saveAs(action.slice(8));
    if (action.startsWith('save-atlas:')) return this.saveAtlas(action.slice(11));
    if (!this.current()) return;
    if (action === 'rotate') { if (this.mode !== 'editor') await this.setMode('editor'); this.selectTool('rotate'); return; }
    if (action === 'reset') return this.resetOriginal();
    if (action === 'undo' || action === 'redo') {
      if (action === 'undo' && this.hasAdjustments()) { this.effects = this.cloneEffects(this.historyEffects[this.index]); this.previewPixels = null; this.renderEffectControls(); this.renderHistory(); this.renderStage(); this.changed(this.dirty); return; }
      return this.jumpHistory(this.index + (action === 'undo' ? -1 : 1));
    }
    if (action === 'apply') return this.applyTool();
    if (action === 'apply-adjust') return this.applyTool();
    if (action === 'apply-crop') { this.selectTool('crop'); return this.applyTool(); }
    if (action === 'pick') { this.selectTool('remove-color'); this.pickColor = true; this.q('canvas').classList.add('is-picking'); this.message('Click the background color in the image.'); return; }
    if (imageToolDefinitions.some(([id]) => id === action)) return this.toggleEffect(action, true);
  }
  deactivate() { if (this.mode === 'viewer') void this.setMode('editor').catch(() => {}); }
  dispose() { this.clearLoopPreview(); this.resizeObserver.disconnect(); this.thumbObserver.disconnect(); this.disposeDragError?.(); }
}

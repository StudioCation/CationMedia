import { toolButton, toolIcon } from './Controls.mjs';
import { ResizablePanel } from '../managers/ResizablePanel.mjs';
import { detectMediaType } from '../../shared/mediaTypes.mjs';
import { clipRange, clipAudio, trimClip, splitClip, timelineScale } from '../../shared/audioTimeline.mjs';
import { MAX_AUDIO_BYTES } from '../../shared/audio.mjs';
import { bindMiddlePan } from './MiddlePan.mjs';

export class AudioTimeline {
  constructor(editor) {
    this.editor = editor; this.clips = []; this.layers = 1; this.layerGains = [1]; this.active = null; this.saved = []; this.revision = 0; this.savedRevision = 0; this.mixGeneration = 0;
    this.element = document.createElement('section'); this.element.className = 'audio-timeline'; this.element.id = 'audio-timeline';
    const button = (action, label, icon) => toolButton({ label, icon, attributes: `type="button" data-action="${action}"` });
    this.element.innerHTML = `<div class="resize-handle timeline-resizer" role="separator" tabindex="0" aria-label="Resize timeline" aria-orientation="horizontal"></div><div class="timeline-tools media-toolbar tools" role="toolbar" aria-label="Timeline tools"><span class="timeline-heading">Layers</span><div class="media-tool-group">${button('layer', 'Add layer', 'layers-add')}${button('import', 'Add audio / video', 'file-plus')}<span class="media-divider"></span>${button('duplicate', 'Duplicate clip (Ctrl+D)', 'copy')}${button('split', 'Split at playhead (Ctrl+Shift+D)', 'cut')}${button('remove', 'Remove selected layer', 'trash')}${button('export', 'Save mix', 'download')}</div><span data-selected class="timeline-selected"></span><div class="media-tool-group"><label class="timeline-zoom">Zoom<input data-zoom type="range" min="10" max="200" value="50" aria-label="Timeline zoom"></label><span class="media-divider"></span>${button('play', 'Play / Pause mix', 'player-play')}${button('stop', 'Stop mix', 'player-stop')}${button('collapse', 'Hide timeline', 'chevron-down')}</div></div><div class="timeline-scroll"><div class="timeline-tracks"></div></div><div class="media-status"><span class="timeline-hint">Drop files to create layers · Drag clip edges to trim</span><output data-time aria-label="Mix playback time">00:00.000</output></div>`;
    editor.$('wave-area').closest('.audio-editor').after(this.element);
    this.tracks = this.element.querySelector('.timeline-tracks'); this.scroll = this.element.querySelector('.timeline-scroll'); this.zoomValue = 50; this.scale = 50;
    this.unbindPan = bindMiddlePan(this.scroll, (dx, dy) => { this.scroll.scrollLeft += dx; this.scroll.scrollTop += dy; });
    this.toggle = document.createElement('div'); this.toggle.className = 'timeline-toggle tools';
    this.toggle.innerHTML = toolButton({ label: 'Show timeline', icon: 'chevron-up', attributes: 'type="button" aria-expanded="false" aria-controls="audio-timeline"' });
    this.element.after(this.toggle); this.toggle.querySelector('button').onclick = () => this.show(true);
    this.show(false);
    const actions = { layer: () => { if (this.layers >= 32) return; this.layers++; this.layerGains.push(1); this.touch(); }, import: () => this.import(), play: () => this.play(), stop: () => this.stop(), export: async () => { await editor.command('export'); editor.$('export-selection').checked = false; }, remove: () => this.removeLayer(this.active?.layer ?? 0), duplicate: () => this.duplicate(), split: () => this.split(), collapse: () => this.show(false) };
    this.element.querySelectorAll('[data-action]').forEach(b => b.onclick = () => { if (!editor.working) void Promise.resolve(actions[b.dataset.action]()).catch(error => editor.message(error.message)); });
    this.element.querySelector('[data-zoom]').oninput = e => { this.zoomValue = Number(e.target.value); this.render(); };
    this.resize = new ResizeObserver(() => { if (!this.element.hidden) this.render(); }); this.resize.observe(this.scroll);
    this.panelSize = new ResizablePanel({ handle: this.element.querySelector('.timeline-resizer'), panel: this.element, key: 'audio-timeline', axis: 'y', initial: 240, limits: () => [145, Math.max(145, editor.host.clientHeight - 200)] });
  }
  show(expanded) {
    this.element.hidden = !expanded; this.toggle.hidden = expanded;
    this.toggle.querySelector('button').setAttribute('aria-expanded', String(expanded));
    if (expanded) this.render();
  }
  capture() {
    if (!this.active) return;
    for (const key of ['channels', 'sampleRate', 'history', 'future', 'selection', 'cursor', 'zoom', 'offset', 'loopRegions', 'activeLoop', 'loopHighlight', 'loop']) this.active[key] = this.editor[key];
  }
  reset() {
    this.stop(); this.layers = 1; this.layerGains = [1]; this.clips = []; this.active = null; this.revision = this.savedRevision = 0;
    this.active = { id: crypto.randomUUID(), name: this.editor.name, layer: 0, start: 0 };
    this.capture(); this.clips.push(this.active); this.markSaved(); this.show(false); this.render();
  }
  get dirty() { this.capture(); return this.revision !== this.savedRevision || this.clips.some((c, i) => c.channels !== this.saved[i]); }
  markSaved() { this.capture(); this.saved = this.clips.map(c => c.channels); this.savedRevision = this.revision; }
  touch() { this.stop(false); this.revision++; this.render(); this.editor.syncSaveControls(); this.editor.changed?.(); }
  select(clip, internal = false) {
    if ((this.editor.working && !internal) || clip === this.active) return;
    this.capture(); this.stop(false); this.editor.stop(); this.editor.closePreview(); this.active = clip;
    for (const key of ['channels', 'sampleRate', 'history', 'future', 'selection', 'cursor', 'zoom', 'offset', 'loopRegions', 'activeLoop', 'loopHighlight', 'loop']) this.editor[key] = clip[key];
    this.editor.refresh(null, { preserveLoops: true });
  }
  async import(files, start = 0) {
    await this.editor.job('Importing timeline audio…', async () => {
      this.capture();
      let descriptors;
      if (!files) { if (!window.desktop?.importAudio) throw new Error('Use file drop in browser mode.'); descriptors = await window.desktop.importAudio(); }
      else descriptors = await Promise.all([...files].map(async file => {
        if (!['audio', 'video'].includes(detectMediaType(file.name)?.id)) throw new Error(`Not audio or video: ${file.name}`);
        if (window.desktop?.importAudioFile) return window.desktop.importAudioFile(file);
        return { name: file.name, data: null, url: URL.createObjectURL(file), revoke: true };
      }));
      const staged = [];
      for (const descriptor of descriptors || []) {
        try {
          const result = await this.editor.load(descriptor);
          staged.push({ ...result, id: crypto.randomUUID(), name: descriptor.name, layer: this.layers + staged.length, start, history: [], future: [], selection: [0, 0], cursor: 0, zoom: 1, offset: 0, loopRegions: [], activeLoop: null, loopHighlight: false, loop: false });

        } finally { if (descriptor.revoke) URL.revokeObjectURL(descriptor.url); }
      }
      if (this.layers + staged.length > 32) throw new Error('Maximum 32 layers.');
      const bytes = [...this.clips, ...staged].reduce((sum, c) => sum + c.channels[0].length * c.channels.length * 4, 0);
      if (bytes > MAX_AUDIO_BYTES) throw new Error('Timeline sources exceed the 256 MB decoded limit.');
      if (staged.length) { this.clips.push(...staged); this.layers += staged.length; this.layerGains.push(...staged.map(() => 1)); if (!this.active) this.select(staged[0], true); this.show(true); this.touch(); }
    });
  }
  drop(files, event) {
    const rect = this.tracks.getBoundingClientRect();
    return this.import(files, !this.element.hidden && this.element.contains(event.target) ? Math.max(0, (event.clientX - rect.left - 100) / this.scale) : 0);
  }
  removeLayer(layer) {
    if (this.editor.working || layer < 0 || layer >= this.layers) return;
    this.capture(); this.stop(false); this.editor.stop();
    const removed = this.clips.find(c => c.layer === layer);
    if (removed === this.active) {
      const next = this.clips.find(c => c !== removed);
      if (next) this.select(next);
      else { this.active = null; this.editor.channels = [new Float32Array(1)]; this.editor.selection = [0, 0]; this.editor.cursor = 0; this.editor.history = []; this.editor.future = []; this.editor.refresh(); }
    }
    this.clips = this.clips.filter(c => c.layer !== layer);
    this.clips.forEach(c => { if (c.layer > layer) c.layer--; });
    this.layers = Math.max(0, this.layers - 1); this.layerGains.splice(layer, 1); this.touch();
  }
  duplicate() {
    if (!this.active || this.layers >= 32 || this.editor.working) return;
    this.capture(); const gain = this.layerGains[this.active.layer]; const clip = { ...this.active, id: crypto.randomUUID(), layer: this.layers++, history: [], future: [], selection: [0, 0], cursor: 0 };
    this.layerGains.push(gain);
    this.clips.push(clip); this.select(clip); this.touch();
  }
  split() {
    if (!this.active || this.layers >= 32 || this.editor.working) return;
    this.capture(); this.stop(false); const halves = splitClip(this.active, this.mixCursor || 0);
    if (!halves) return this.editor.message('Place the playhead inside the selected clip.');
    const clip = { ...this.active, ...halves[1], id: crypto.randomUUID(), layer: this.layers++, history: [], future: [], selection: [0, 0], cursor: 0 };
    this.layerGains.push(this.layerGains[this.active.layer]);
    Object.assign(this.active, halves[0]); this.clips.push(clip); this.touch();
  }
  seek(time) { this.stop(false); this.editor.stop(false); this.mixCursor = Math.max(0, Math.min(this.duration, time)); this.clock(); }
  get duration() { return Math.max(0, ...this.clips.map(c => c.start + clipRange(c).duration)); }
  context(layer, event) {
    event.preventDefault(); event.stopPropagation(); if (this.editor.working) return;
    const clip = this.clips.find(c => c.layer === layer); if (clip) this.select(clip);
    this.contextLayer = layer;
    void window.desktop?.contextMenu({ mediaType: 'audio', timeline: true, layer, clip: Boolean(clip), canAdd: this.layers < 32 }).catch(error => this.editor.message(error.message));
  }
  render() {
    this.capture(); this.tracks.replaceChildren();
    this.element.querySelector('[data-selected]').textContent = this.active?.name || '';
    this.element.querySelector('[data-selected]').title = this.active?.name || '';
    this.syncControls();
    const duration = Math.max(10, ...this.clips.map(c => c.start + clipRange(c).duration)) + 5;
    this.scale = timelineScale(this.zoomValue, duration, this.scroll.clientWidth);
    this.tracks.style.width = `${100 + duration * this.scale}px`;
    const ruler = document.createElement('div'); ruler.className = 'timeline-ruler';
    for (let t = 0; t <= duration; t += Math.max(1, Math.ceil(60 / this.scale))) { const tick = document.createElement('span'); tick.style.left = `${100 + t * this.scale}px`; tick.textContent = `${t}s`; ruler.append(tick); }
    ruler.onpointerdown = e => { if (e.button === 0 && !this.editor.working) { e.preventDefault(); this.seek((e.clientX - this.tracks.getBoundingClientRect().left - 100) / this.scale); } };
    this.tracks.append(ruler);
    for (let i = 0; i < this.layers; i++) {
      const lane = document.createElement('div'); lane.className = 'timeline-lane'; lane.dataset.layer = i; lane.oncontextmenu = event => this.context(i, event); lane.onpointerdown = event => { if (event.target === lane && event.button === 0) this.seek((event.clientX - this.tracks.getBoundingClientRect().left - 100) / this.scale); };
      const label = document.createElement('span'); label.className = 'timeline-label';
      const name = document.createElement('span'); name.textContent = `Layer ${i + 1}`;
      const gain = document.createElement('input'); gain.type = 'range'; gain.min = '0'; gain.max = '2'; gain.step = '0.01'; gain.value = String(this.layerGains[i] ?? 1);
      gain.disabled = Boolean(this.editor.working);
      gain.setAttribute('aria-label', `Layer ${i + 1} volume`); gain.title = `Layer ${i + 1} volume: ${Math.round(Number(gain.value) * 100)}%`;
      gain.onpointerdown = event => { if (event.button !== 1) event.stopPropagation(); };
      gain.oninput = () => { this.setLayerGain(i, Number(gain.value)); gain.title = `Layer ${i + 1} volume: ${Math.round(Number(gain.value) * 100)}%`; };
      label.append(name, gain); lane.append(label);
      for (const clip of this.clips.filter(c => c.layer === i)) {
        const block = document.createElement('button'); block.className = 'timeline-clip'; block.dataset.clip = clip.id; block.setAttribute('aria-pressed', String(clip === this.active));
        block.textContent = clip.name; block.title = `${clip.name} · ${clip.start.toFixed(3)} s`; block.style.left = `${100 + clip.start * this.scale}px`; block.style.width = `${Math.max(12, clipRange(clip).duration * this.scale)}px`;
        for (const edge of ['left', 'right']) { const handle = document.createElement('span'); handle.className = `timeline-trim ${edge}`; handle.dataset.edge = edge; handle.title = `Trim ${edge} edge`; block.append(handle); }
        block.onpointerdown = e => {
          if (e.button !== 0 || this.editor.working) return;
          e.preventDefault(); const edge = e.target.dataset.edge; this.select(clip); this.stop(false); this.editor.stop(false);
          // Selection rebuilds the lane; capture on the persistent tracks element.
          this.tracks.setPointerCapture(e.pointerId); this.drag = { clip, x: e.clientX, y: e.clientY, start: clip.start, layer: clip.layer, edge, original: { ...clip, trimStart: clip.trimStart || 0, trimEnd: clip.trimEnd } };
        };
        block.onclick = () => this.select(clip); lane.append(block);
      }
      this.tracks.append(lane);
    }
    const playhead = document.createElement('div'); playhead.className = 'timeline-playhead'; playhead.setAttribute('aria-hidden', 'true'); this.tracks.append(playhead); this.clock();
    this.tracks.onpointermove = e => {
      if (!this.drag) return; const d = this.drag;
      if (d.edge) { Object.assign(d.clip, trimClip(d.original, d.edge, (e.clientX - d.x) / this.scale)); this.render(); return; }
      d.clip.start = Math.max(0, Math.round((d.start + (e.clientX - d.x) / this.scale) * 1000) / 1000);
      const layer = Math.max(0, Math.min(this.layers - 1, d.layer + Math.round((e.clientY - d.y) / 52)));
      if (!this.clips.some(c => c !== d.clip && c.layer === layer)) d.clip.layer = layer;
      this.render();
    };
    this.tracks.onpointerup = e => { if (!this.drag) return; const d = this.drag; this.drag = null; this.tracks.releasePointerCapture(e.pointerId); if (d.edge || d.start !== d.clip.start || d.layer !== d.clip.layer) this.touch(); };
    this.tracks.onpointercancel = () => { if (this.drag) { Object.assign(this.drag.clip, this.drag.original); this.drag = null; this.render(); } };
  }
  setLayerGain(layer, value) {
    if (this.editor.working || layer < 0 || layer >= this.layers || !Number.isFinite(value)) return;
    const gain = Math.max(0, Math.min(2, value));
    if (this.layerGains[layer] === gain) return;
    this.layerGains[layer] = gain; this.revision++; this.editor.changed?.();
    if (this.source) { clearTimeout(this.gainTimer); this.gainTimer = setTimeout(() => void this.updatePlayingMix(), 100); }
  }
  syncControls() {
    for (const gain of this.tracks.querySelectorAll('.timeline-label input[type=range]')) gain.disabled = Boolean(this.editor.working);
    this.element.querySelector('[data-action="remove"]').disabled = this.editor.working || !this.layers;
    this.element.querySelector('[data-action="layer"]').disabled = this.editor.working || this.layers >= 32;
    for (const action of ['duplicate', 'split']) this.element.querySelector(`[data-action="${action}"]`).disabled = this.editor.working || !this.active || this.layers >= 32;
    for (const action of ['play', 'stop']) this.element.querySelector(`[data-action="${action}"]`).disabled = this.editor.working || !this.clips.length;
    this.playbackUI();
  }
  async mix() {
    this.capture();
    const worker = new Worker(new URL('../workers/audioMix.mjs', import.meta.url), { type: 'module' });
    try { return await new Promise((resolve, reject) => { worker.onmessage = e => e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); worker.onerror = e => reject(new Error(e.message)); worker.postMessage({ clips: this.clips.map(clip => ({ ...clipAudio(clip), gain: this.layerGains[clip.layer] ?? 1 })), sampleRate: this.editor.sampleRate }); }); }
    finally { worker.terminate(); }
  }
  async play() {
    if (this.source) { this.stop(false); return; }
    const offset = this.mixCursor || 0;
    const mixed = await this.editor.job('Preparing mix…', () => this.mix()); if (!mixed || this.editor.host.hidden) return;
    this.editor.context ||= new AudioContext(); const context = this.editor.context; await context.resume();
    this.startMixedSource(mixed, offset);
    const tick = () => { if (!this.source) return; this.mixCursor = this.source.loop ? (context.currentTime - this.mixStarted) % this.mixDuration : Math.min(this.mixDuration, context.currentTime - this.mixStarted); this.clock(); this.frame = requestAnimationFrame(tick); }; tick();
  }
  startMixedSource(mixed, offset) {
    const context = this.editor.context;
    const buffer = context.createBuffer(mixed.channels.length, mixed.channels[0].length, mixed.sampleRate); mixed.channels.forEach((c, i) => buffer.copyToChannel(c, i));
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.editor.output());
    this.mixCursor = offset < buffer.duration ? offset : 0; this.mixStarted = context.currentTime - this.mixCursor;
    source.loop = this.editor.loop; this.mixDuration = buffer.duration;
    const previous = this.source; this.source = source;
    if (previous) { previous.onended = null; previous.stop(); previous.disconnect(); }
    source.onended = () => { if (this.source === source) this.stop(); };
    source.start(0, this.mixCursor); this.playbackUI();
  }
  async updatePlayingMix() {
    if (!this.source || this.editor.working) return;
    const generation = ++this.mixGeneration;
    try {
      const mixed = await this.mix();
      if (generation !== this.mixGeneration || !this.source) return;
      const context = this.editor.context;
      const cursor = this.source.loop ? (context.currentTime - this.mixStarted) % this.mixDuration : Math.min(this.mixDuration, context.currentTime - this.mixStarted);
      this.startMixedSource(mixed, cursor);
    } catch (error) { if (generation === this.mixGeneration) this.editor.message(error.message); }
  }
  clock() { const head = this.tracks.querySelector('.timeline-playhead'); if (head) head.style.left = `${100 + (this.mixCursor || 0) * this.scale}px`; const t = this.mixCursor || 0; this.element.querySelector('[data-time]').textContent = `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}`; }
  playbackUI() { const button = this.element.querySelector('[data-action="play"]'); button.innerHTML = toolIcon(this.source ? 'player-pause' : 'player-play'); button.setAttribute('aria-pressed', String(Boolean(this.source))); if (!this.editor.source) this.editor.$('play').innerHTML = toolIcon(this.source ? 'player-pause' : 'player-play'); }
  stop(reset = true) { clearTimeout(this.gainTimer); this.mixGeneration = (this.mixGeneration || 0) + 1; cancelAnimationFrame(this.frame); if (this.source) { this.mixCursor = this.source.loop ? (this.editor.context.currentTime - this.mixStarted) % this.mixDuration : Math.min(this.mixDuration, this.editor.context.currentTime - this.mixStarted); this.source.onended = null; this.source.stop(); this.source.disconnect(); this.source = null; } if (reset) this.mixCursor = 0; this.clock(); this.playbackUI(); }
  dispose() { this.stop(); this.unbindPan(); this.resize.disconnect(); this.panelSize.dispose(); }
}

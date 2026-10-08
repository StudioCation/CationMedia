import { audioFormats } from '../../shared/mediaTypes.mjs';
import { encodeWave, decodeWave, clamp, MAX_AUDIO_BYTES } from '../../shared/audio.mjs';
import { toolIcon, toolButton, numberFieldMarkup, sliderFieldMarkup, bindSliderFields } from './Controls.mjs';
import { styleDialog } from './Dialog.mjs';
import { AudioEffectPreview } from './AudioEffectPreview.mjs';
import { AudioTimeline } from './AudioTimeline.mjs';
import { bindMiddlePan } from './MiddlePan.mjs';

const icons = {
  mute: 'volume', play: 'player-play', pause: 'player-pause', stop: 'player-stop', start: 'player-skip-back',
  loop: 'repeat', undo: 'arrow-back-up', redo: 'arrow-forward-up', 'save-changes': 'save', 'save-as': 'save-as',
  'fade-selection-in': 'trending-up', 'fade-selection-out': 'trending-down',
  'find-loops': 'zoom-scan', 'clear-loops': 'repeat-off',
  'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', fit: 'arrows-maximize', 'zoom-selection': 'zoom-in-area',
  all: 'select-all', clear: 'x', trim: 'crop', delete: 'trash'
};
const icon = id => toolIcon(icons[id]);
const button = (id, title, svg = id) => toolButton({ id: `audio-${id}`, label: title, icon: icons[svg] });
const field = (id, ...args) => numberFieldMarkup(`audio-${id}`, ...args);
const time = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`;

export class AudioWorkspace {
  constructor(host, { message, busy, changed }) {
    this.host = host; this.message = message; this.setBusy = busy; this.changed = changed; this.channels = null;
    this.selection = [0, 0]; this.cursor = 0; this.zoom = 1; this.offset = 0; this.loop = false; this.history = []; this.future = []; this.savedChannels = this.channels;
    host.innerHTML = `<div class="audio-toolbar media-toolbar tools" role="toolbar" aria-label="Audio tools">
    <div class="audio-edit-tools"><div class="audio-tool-group" role="group" aria-label="Selection tools">${button('all', 'Select all (Ctrl+A)')}${button('clear', 'Clear selection')}${button('trim', 'Trim to selection')}${button('delete', 'Delete selection')}</div>
    <span class="audio-divider"></span><div class="audio-tool-group" role="group" aria-label="Selection fades">${button('fade-selection-in', 'Fade in selection: 0 → 100%')}${button('fade-selection-out', 'Fade out selection: 100 → 0%')}</div>
    <span class="audio-divider"></span><div class="audio-tool-group">${button('undo', 'Undo (Ctrl+Z)')}${button('redo', 'Redo (Ctrl+Y)')}</div>
    <span class="audio-divider"></span><div class="audio-tool-group">${button('find-loops', 'Loop finder: unique regions, up to 20 s')}${button('clear-loops', 'Clear loop regions')}</div>
    <span class="audio-divider"></span><div class="audio-tool-group" role="group" aria-label="Save audio">${button('save-changes', 'Save (Ctrl+S)')}${button('save-as', 'Save as… (Ctrl+Shift+S)')}</div>
    </div><div class="audio-zoom">${button('zoom-out', 'Zoom out')}${button('fit', 'Fit waveform')}${button('zoom-in', 'Zoom in')}${button('zoom-selection', 'Zoom selection')}</div>
    <div class="audio-tool-group audio-transport" role="group" aria-label="Playback">${button('mute', 'Mute playback')}<input id="audio-volume" type="range" min="0" max="1" value="1" step="0.01" aria-label="Playback volume"><span class="audio-divider"></span>${button('start', 'Go to start (Home)')}${button('play', 'Play / Pause (Space)')}${button('stop', 'Stop (Esc)')}${button('loop', 'Loop playback (L)')}</div></div>
    <div class="audio-editor"><div class="audio-wave-area" id="audio-wave-area" tabindex="0" role="group" aria-label="Audio waveform. Drag to select; click to seek. I and O set boundaries."><canvas id="audio-wave"></canvas><canvas id="audio-overlay"></canvas><div id="audio-loops" aria-label="Loop regions"></div><div id="audio-playhead"></div><button type="button" id="audio-selection-start" class="audio-selection-handle" data-edge="0" aria-label="Drag selection start" hidden></button><button type="button" id="audio-selection-end" class="audio-selection-handle" data-edge="1" aria-label="Drag selection end" hidden></button></div>
    <input id="audio-scroll" type="range" min="0" max="0" value="0" step="0.001" aria-label="Scroll audio timeline"></div>
    <div class="audio-bottom"><span id="audio-state" role="status">Ready</span><output id="audio-clock" aria-label="Current playback time">00:00.000</output><span id="audio-info"></span></div>
    <dialog id="audio-effect-dialog"><form method="dialog"><h2 id="audio-effect-title"></h2><p class="inspector-note">Applies to the selection, or the entire file. Undo is available.</p><div id="audio-effect-fields"></div><div class="dialog-actions"><button id="audio-apply-effect" class="primary" type="button">Apply</button><button>Cancel</button></div></form></dialog>
    <dialog id="audio-export-dialog"><form method="dialog"><h2>Save audio as</h2><label class="inspector-field">Format<select id="audio-format" aria-label="Audio export format">${audioFormats.map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('')}</select></label><label class="inspector-field">Quality<select id="audio-quality" aria-label="Audio quality"><option value="standard">Standard</option><option value="high" selected>High</option><option value="maximum">Maximum</option></select></label><p id="audio-quality-help" class="inspector-note"></p><label class="inspector-field">Sample rate<select id="audio-rate" aria-label="Export sample rate"><option value="0">Original</option><option value="22050">22,050 Hz</option><option value="44100">44,100 Hz</option><option value="48000">48,000 Hz</option><option value="96000">96,000 Hz</option></select></label><label class="check"><input id="audio-export-selection" type="checkbox">Export selected range only</label><p>Current edits are included. The source is only replaced if you choose it in the Save dialog.</p><div class="dialog-actions"><button id="audio-save" class="primary" type="button">Save…</button><button>Cancel</button></div></form></dialog>`;
    host.querySelectorAll('dialog').forEach(styleDialog);
    this.$ = id => host.querySelector(`#audio-${id}`);
    this.monitorVolume = 1; this.monitorMuted = false;
    this.$('volume').oninput = () => { this.monitorVolume = Number(this.$('volume').value); this.monitorMuted = false; this.updateVolume(); };
    this.$('mute').onclick = () => { this.monitorMuted = !this.monitorMuted; this.updateVolume(); };
    this.$('quality').closest('label').insertAdjacentHTML('afterend', '<input id="audio-quality-slider" type="range" min="0" max="2" step="1" value="1" aria-label="Audio quality slider">');
    this.$('quality-help').insertAdjacentHTML('afterend', `<div id="audio-bitrate-fields" hidden>${sliderFieldMarkup('audio-bitrate', 'Bitrate (kbps)', 64, 320, 192, 32)}</div>`);
    this.syncExportSliders = bindSliderFields(host);
    this.$('quality-slider').oninput = () => { this.$('quality').selectedIndex = Number(this.$('quality-slider').value); this.exportQuality(); };
    this.$('bitrate').oninput = () => { this.$('quality-help').textContent = `Custom · ${this.$('bitrate').value} kbps`; };
    this.$('effect-fields').insertAdjacentHTML('afterend', `<div class="audio-audition" role="group" aria-label="Effect preview"><span>Preview</span><div><button type="button" id="audio-preview-before" aria-pressed="false">${toolIcon('player-play')}Before</button><button type="button" id="audio-preview-after" aria-pressed="false">${toolIcon('player-play')}After</button>${toolButton({ id: 'audio-preview-stop', label: 'Stop preview', icon: 'player-stop', attributes: 'type="button"' })}</div></div><p id="audio-preview-status" role="status" class="inspector-note">Changes are made only when you apply the effect.</p>`);
    for (const mode of ['before', 'after']) this.$(`preview-${mode}`).onclick = () => { if (!this.$('effect-dialog').querySelector('form').reportValidity()) return; clearTimeout(this.previewTimer); void this.preview?.audition(mode, this.effectValue()); };
    this.$('preview-stop').onclick = () => { clearTimeout(this.previewTimer); this.preview?.stop(); };
    this.$('effect-dialog').addEventListener('close', () => { if (!this.$('effect-dialog').open) this.closePreview(); });
    this.$('effect-dialog').addEventListener('cancel', event => { if (this.working) event.preventDefault(); });
    this.$('export-dialog').addEventListener('close', () => { this.exportRange = null; });
    for (const action of ['play', 'stop', 'start', 'loop', 'undo', 'redo', 'all', 'clear', 'trim', 'delete', 'find-loops', 'clear-loops', 'fade-selection-in', 'fade-selection-out']) this.$(action).onclick = () => void this.command(action);
    this.$('apply-effect').onclick = async () => { await this.effect(this.currentEffect); };
    this.nodes = new Map(); this.peakCache = new WeakMap(); this.loopRegions = []; this.$('clear-loops').disabled = true;
    this.$ = id => { if (!this.nodes.has(id)) this.nodes.set(id, host.querySelector(`#audio-${id}`)); return this.nodes.get(id); };
    this.$('zoom-in').onclick = () => this.setZoom(this.zoom * 2); this.$('zoom-out').onclick = () => this.setZoom(this.zoom / 2);
    this.$('fit').onclick = () => { this.offset = 0; this.setZoom(1); };
    this.$('zoom-selection').onclick = () => { if (this.hasSelection) { this.offset = this.selection[0]; this.setZoom(this.duration / (this.selection[1] - this.selection[0]), false); } };
    this.$('scroll').oninput = () => { this.offset = Number(this.$('scroll').value); this.draw(); };
    this.$('save').onclick = () => void this.save();
    this.$('save-changes').onclick = () => void this.command('save');
    this.$('save-as').onclick = () => void this.command('export');
    this.$('save-changes').disabled = this.$('save-as').disabled = true;
    this.$('format').onchange = () => this.exportQuality(); this.$('quality').onchange = () => this.exportQuality(); this.exportQuality();
    this.bindWave(); this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(this.$('wave-area'));
    this.$('wave-area').oncontextmenu = event => { event.preventDefault(); if (!this.working) void window.desktop?.contextMenu({ mediaType: 'audio', selected: this.hasSelection, loop: this.loop, undo: Boolean(this.history.length), redo: Boolean(this.future.length) }).catch(error => this.message(error.message)); };
  }
  get dirty() { return this.timeline ? this.timeline.dirty : this.channels !== this.savedChannels; }
  get duration() { return (this.channels?.[0].length || 0) / (this.sampleRate || 1); }
  get hasSelection() { return this.selection[1] - this.selection[0] >= 1 / (this.sampleRate || 1); }
  get range() { return this.activeLoop ? [this.activeLoop.start, this.activeLoop.end] : this.hasSelection ? this.selection : [0, this.duration]; }
  async load(descriptor) {
    if (descriptor.data) return { ...await this.analyze({ data: descriptor.data }, [descriptor.data.buffer || descriptor.data]), documentId: descriptor.documentId };
    const asset = descriptor.assets?.find(a => a.name === descriptor.name), url = asset?.url || descriptor.url;
    const bytes = await (await fetch(url)).arrayBuffer();
    const context = new AudioContext();
    try { const buffer = await context.decodeAudioData(bytes); if (buffer.length * buffer.numberOfChannels * 4 > MAX_AUDIO_BYTES) throw new Error('Audio exceeds the 256 MB decoded limit.'); return { channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()), sampleRate: buffer.sampleRate }; }
    finally { await context.close(); }
  }
  install(result, name) {
    this.stop(); this.channels = result.channels; this.sampleRate = result.sampleRate; this.name = name; this.documentId = result.documentId; this.saveFormat = name.split('.').pop().toLowerCase();
    this.history = []; this.future = []; this.savedChannels = this.channels; this.zoom = 1; this.offset = 0; this.cursor = 0; this.selection = [0, 0]; this.loop = false;
    this.loopRegions = []; this.activeLoop = null; this.loopHighlight = false; this.contextLoop = null;
    this.host.dataset.name = name; this.timeline ||= new AudioTimeline(this); this.timeline.reset(); this.refresh(result.peaks);
  }
  refresh(peaks, { preserveLoops = false } = {}) {
    peaks ||= this.peakCache.get(this.channels);
    if (peaks) this.peakCache.set(this.channels, peaks);
    if (preserveLoops) {
      this.loopRegions = (this.loopRegions || []).filter(region => Number.isFinite(region.start) && Number.isFinite(region.end) && region.start >= 0 && region.end > region.start && region.end <= this.duration + 1 / this.sampleRate);
      if (!this.loopRegions.includes(this.activeLoop)) { if (this.activeLoop) this.loop = false; this.activeLoop = null; }
      if (!this.loopRegions.length) this.loopHighlight = false;
    } else {
      if (this.activeLoop) this.loop = false;
      this.activeLoop = null; this.loopHighlight = false; this.loopRegions = []; this.contextLoop = null;
    }
    this.buffer = null; this.peaks = peaks || null; this.waveKey = null; this.$('loops').replaceChildren(); this.$('clear-loops').disabled = !this.loopRegions.length;
    const channels = this.channels;
    if (!peaks) void this.analyze({ channels, sampleRate: this.sampleRate }).then(result => { this.peakCache.set(channels, result.peaks); if (this.channels === channels && !this.disposed) { this.peaks = result.peaks; this.waveKey = null; this.draw(); } }).catch(error => { if (!this.disposed) this.message(error.message); });
    this.select(...this.selection, false);
    this.$('info').textContent = `${this.channels.length === 1 ? 'Mono' : this.channels.length === 2 ? 'Stereo' : this.channels.length + ' channels'} · ${this.sampleRate.toLocaleString()} Hz · ${time(this.duration)}`;
    this.$('undo').disabled = !this.history.length; this.$('redo').disabled = !this.future.length;
    this.syncSaveControls();
    this.$('loop').setAttribute('aria-pressed', String(this.loop)); this.$('state').textContent = this.dirty ? 'Edited · Ctrl+S to save' : 'Ready';
    this.$('wave-area').dataset.channels = this.channels.length; this.timeline?.render(); this.changed?.(); this.draw();
  }
  select(a, b, stop = true) {
    if (!this.channels || !Number.isFinite(a) || !Number.isFinite(b)) return;
    if (stop) this.stop();
    if (this.activeLoop) { a = this.activeLoop.start; b = this.activeLoop.end; }
    this.selection = [Math.round(clamp(Math.min(a, b), 0, this.duration) * this.sampleRate) / this.sampleRate, Math.round(clamp(Math.max(a, b), 0, this.duration) * this.sampleRate) / this.sampleRate];
    this.$('trim').disabled = this.$('delete').disabled = this.$('fade-selection-in').disabled = this.$('fade-selection-out').disabled = !this.hasSelection;
    this.draw();
  }
  syncSaveControls() {
    const disabled = this.working || !this.channels || (this.timeline && !this.timeline.clips.length) || !window.desktop?.exportAudio;
    this.$('save-changes').disabled = this.$('save-as').disabled = Boolean(disabled);
  }
  output() {
    if (!this.monitorGain || this.monitorGain.context !== this.context) { this.monitorGain = this.context.createGain(); this.monitorGain.connect(this.context.destination); }
    this.updateVolume(); return this.monitorGain;
  }
  updateVolume() {
    if (this.monitorGain) this.monitorGain.gain.value = this.monitorMuted ? 0 : this.monitorVolume;
    this.$('mute').innerHTML = toolIcon(this.monitorMuted || this.monitorVolume === 0 ? 'volume-off' : 'volume');
    this.$('mute').setAttribute('aria-pressed', String(this.monitorMuted));
  }
  async play() {
    if (!this.channels || this.working) return;
    this.timeline?.stop();
    if (this.source) { this.stop(false); return; }
    const generation = this.playGeneration = (this.playGeneration || 0) + 1;
    this.context ||= new AudioContext(); await this.context.resume();
    if (generation !== this.playGeneration || this.host.hidden) return;
    if (!this.buffer) { this.buffer = this.context.createBuffer(this.channels.length, this.channels[0].length, this.sampleRate); this.channels.forEach((channel, i) => this.buffer.copyToChannel(channel, i)); }
    const [a, b] = this.range; if (this.cursor < a || this.cursor >= b - 1 / this.sampleRate) this.cursor = a;
    const source = this.context.createBufferSource(); source.buffer = this.buffer; source.loop = this.loop; source.loopStart = a; source.loopEnd = b; source.connect(this.output());
    this.playRange = [a, b];
    this.startedAt = this.context.currentTime; this.startedOffset = this.cursor; this.source = source;
    source.onended = () => { if (this.source === source) { this.source = null; source.disconnect(); this.cursor = a; this.updatePlayhead(); this.$('play').innerHTML = icon('play'); } };
    if (this.loop) source.start(0, this.cursor); else source.start(0, this.cursor, b - this.cursor);
    this.$('play').innerHTML = icon('pause'); this.tick();
  }
  position() {
    if (!this.source) return this.cursor;
    const [a, b] = this.playRange, elapsed = this.context.currentTime - this.startedAt + this.startedOffset - a;
    return this.source.loop ? a + elapsed % (b - a) : Math.min(b, a + elapsed);
  }
  stop(reset = true) {
    this.playGeneration = (this.playGeneration || 0) + 1;
    if (this.source) { this.cursor = this.position(); const source = this.source; this.source = null; source.onended = null; source.stop(); source.disconnect(); }
    cancelAnimationFrame(this.frame); if (reset) this.cursor = this.range[0];
    this.$('play').innerHTML = icon('play'); this.updatePlayhead();
  }
  tick() { this.updatePlayhead(); if (this.source) this.frame = requestAnimationFrame(() => this.tick()); }
  updatePlayhead() {
    const current = this.position(), width = this.waveWidth || 1;
    const x = 52 + (current - this.offset) / (this.duration / this.zoom || 1) * width;
    this.$('playhead').style.transform = `translateX(${x}px)`; this.$('playhead').hidden = x < 52 || x > width + 52;
    if (this.source && this.timeline?.active) { const clip = this.timeline.active; this.timeline.mixCursor = Math.max(0, clip.start + current - (clip.trimStart || 0) / clip.sampleRate); this.timeline.clock(); }
    const now = performance.now(); if (!this.source || now - (this.clockUpdated || 0) > 50) { this.$('clock').textContent = time(current || 0); this.clockUpdated = now; }
  }
  setZoom(value, anchor = true) {
    if (!this.channels) return;
    const oldSpan = this.duration / this.zoom; this.zoom = clamp(value, 1, Math.max(1, this.duration / .005));
    if (anchor !== false) this.offset += (oldSpan - this.duration / this.zoom) * (typeof anchor === 'number' ? anchor : .5);
    this.offset = clamp(this.offset, 0, this.duration - this.duration / this.zoom);
    this.draw();
  }
  bindWave() {
    const area = this.$('wave-area');
    this.unbindWavePan = bindMiddlePan(area, dx => {
      if (!this.channels || this.working) return;
      const width = Math.max(1, area.clientWidth - 52), span = this.duration / this.zoom;
      this.offset = clamp(this.offset + dx / width * span, 0, this.duration - span);
      this.draw();
    });
    const at = event => { const rect = area.getBoundingClientRect(); return clamp(this.offset + (event.clientX - rect.left - 52) / (rect.width - 52) * this.duration / this.zoom, 0, this.duration); };
    area.onpointerdown = event => {
      if (!this.channels || this.working || event.button !== 0) return;
      area.focus();
      const rect = area.getBoundingClientRect(), x = event.clientX - rect.left;
      const edge = event.target.closest('.audio-selection-handle')?.dataset.edge;
      let boundary = edge === undefined ? -1 : Number(edge);
      if (boundary < 0 && this.hasSelection) {
        const distances = this.selection.map(t => Math.abs(x - (52 + (t - this.offset) / (this.duration / this.zoom) * (rect.width - 52))));
        if (Math.min(...distances) <= 6) boundary = distances[0] <= distances[1] ? 0 : 1;
      }
      if (boundary >= 0) {
        event.preventDefault();
        this.drag = { edge: boundary, fixed: this.selection[1 - boundary], time: at(event), x: event.clientX, playing: Boolean(this.source), moved: false };
        area.setPointerCapture(event.pointerId); return;
      }
      if (this.activeLoop) { this.seek(at(event), true); return; }
      this.drag = { time: at(event), x: event.clientX, playing: Boolean(this.source), moved: false };
      area.setPointerCapture(event.pointerId);
    };
    area.onpointermove = event => {
      if (!this.drag) return;
      if (!this.drag.moved && Math.abs(event.clientX - this.drag.x) >= 3) { this.drag.moved = true; this.stop(false); }
      if (!this.drag.moved) return;
      if (this.drag.edge !== undefined) {
        if (this.activeLoop) { this.activeLoop = null; this.loopHighlight = false; this.updateLoopButtons(); }
        const t = this.drag.edge === 0 ? Math.min(at(event), this.drag.fixed - 1 / this.sampleRate) : Math.max(at(event), this.drag.fixed + 1 / this.sampleRate);
        this.select(this.drag.fixed, t, false);
      } else this.select(this.drag.time, at(event), false);
      this.cursor = this.selection[0]; this.updatePlayhead();
    };
    area.onpointerup = event => {
      if (!this.drag) return;
      const drag = this.drag; this.drag = null; area.releasePointerCapture(event.pointerId);
      if (!drag.moved) { if (drag.edge === undefined) this.seek(at(event), drag.playing); return; }
      if (drag.edge === undefined) this.select(drag.time, at(event), false);
      this.cursor = this.selection[0];
      if (drag.playing) void this.play().catch(error => this.message(error.message));
    };
    area.onpointercancel = () => { this.drag = null; };
    area.addEventListener('wheel', event => {
      if (!this.channels || this.working || this.drag) return;
      event.preventDefault();
      const rect = area.getBoundingClientRect(), width = rect.width - 52;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const delta = (event.deltaX || event.deltaY) * unit;
        this.offset = clamp(this.offset + delta / width * this.duration / this.zoom, 0, this.duration - this.duration / this.zoom);
        this.draw();
      } else if (event.deltaY) {
        const anchor = clamp((event.clientX - rect.left - 52) / width, 0, 1);
        this.setZoom(this.zoom * Math.exp(-clamp(event.deltaY * unit, -240, 240) * .004), anchor);
      }
    }, { passive: false });
  }
  seek(at, play) {
    // A click outside a locked loop must leave both transport and cursor intact.
    if (this.activeLoop || (this.loop && this.hasSelection)) {
      const [start, end] = this.range; if (at < start || at >= end) return;
    }
    this.stop(false);
    if (this.activeLoop || (this.hasSelection && (this.loop || (at >= this.selection[0] && at < this.selection[1])))) {
      const [start, end] = this.range; this.cursor = at >= start && at < end ? at : start;
    } else { this.cursor = clamp(at, 0, this.duration); this.select(this.cursor, this.cursor, false); }
    this.updatePlayhead();
    if (play) void this.play().catch(error => this.message(error.message));
  }
  releaseLoop(resume = Boolean(this.source)) {
    this.stop(false); this.activeLoop = null; this.loop = false; this.loopHighlight = false;
    this.$('loop').setAttribute('aria-pressed', 'false'); this.select(this.cursor, this.cursor, false); this.updateLoopButtons();
    if (resume) void this.play().catch(error => this.message(error.message));
  }
  updateLoopButtons() {
    for (const button of this.$('loops').children) button.setAttribute('aria-pressed', String(this.loopRegions[Number(button.dataset.loopIndex)] === this.activeLoop));
  }
  chooseLoop(region) {
    if (this.working) return;
    if (this.activeLoop === region) { this.releaseLoop(); return; }
    this.stop(false); this.activeLoop = region; this.loop = true; this.loopHighlight = true;
    this.select(region.start, region.end, false); this.cursor = region.start;
    this.$('loop').setAttribute('aria-pressed', 'true'); this.updateLoopButtons();
    void this.play().catch(error => this.message(error.message));
  }
  async fadeSelection(direction) {
    if (!this.hasSelection) return;
    await this.job('Applying selection fade…', async () => {
      const [a, b] = this.selection, channels = this.extract(a, b);
      const result = await this.analyze({ channels, fade: direction }, channels.map(channel => channel.buffer));
      this.replace(result.channels, a, b);
    });
  }
  analyze(payload, transfer = []) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/audioData.mjs', import.meta.url), { type: 'module' });
      this.dataWorkers ||= new Map();
      const finish = () => { worker.terminate(); this.dataWorkers.delete(worker); };
      this.dataWorkers.set(worker, () => { finish(); reject(new Error('Audio analysis cancelled.')); });
      worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data); };
      worker.onerror = event => { finish(); reject(new Error(event.message)); };
      worker.postMessage(payload, transfer);
    });
  }
  draw() {
    if (this.drawFrame || this.disposed) return;
    this.drawFrame = requestAnimationFrame(() => { this.drawFrame = null; this.paint(); });
  }
  paint() {
    if (!this.channels || this.host.hidden) return;
    const canvas = this.$('wave'), rect = this.$('wave-area').getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (rect.width < 60 || rect.height < 20) return;
    const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
    const overlay = this.$('overlay');
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = overlay.width = pixelWidth; canvas.height = overlay.height = pixelHeight; this.waveKey = null; }
    const style = getComputedStyle(this.host), color = name => style.getPropertyValue(name).trim();
    let ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const w = rect.width, h = rect.height, left = 52, width = w - left, span = this.duration / this.zoom;
    this.offset = clamp(this.offset, 0, this.duration - span); this.$('scroll').max = Math.max(0, this.duration - span); this.$('scroll').value = this.offset; this.$('scroll').disabled = this.zoom === 1;
    this.waveWidth = width;
    const waveKey = [this.offset, this.zoom, w, h, dpr, color('--accent'), color('--impion-color-panel-background-soft'), color('--impion-color-panel-background-mute'), this.loopHighlight, JSON.stringify(this.loopRegions)].join(':');
    if (this.waveKey !== waveKey) {
    this.waveKey = waveKey;
    this.waveRenderCount = (this.waveRenderCount || 0) + 1;
    ctx.fillStyle = color('--impion-color-panel-background-soft'); ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr); ctx.font = '11px Segoe UI';
    const ticks = Math.max(2, Math.floor(width / 105));
    for (let i = 0; i <= ticks; i++) { const x = left + i / ticks * width; ctx.strokeStyle = color('--border'); ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, h); ctx.stroke(); ctx.fillStyle = color('--muted'); ctx.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center'; ctx.fillText(time(this.offset + i / ticks * span), x + (i === 0 ? 5 : i === ticks ? -5 : 0), 18); }
    ctx.textAlign = 'left';
    const channelHeight = (h - 30) / this.channels.length;
    this.channels.forEach((channel, c) => {
      const top = 30 + c * channelHeight, mid = top + channelHeight / 2, amplitude = channelHeight * .43;
      ctx.fillStyle = color(c % 2 ? '--impion-color-panel-background-mute' : '--impion-color-panel-background-soft'); ctx.fillRect(left, top, width, channelHeight);
      for (const level of [-1, -.5, 0, .5, 1]) { ctx.strokeStyle = level === 0 ? color('--wave-center') : color('--border'); ctx.beginPath(); ctx.moveTo(left, mid - level * amplitude); ctx.lineTo(w, mid - level * amplitude); ctx.stroke(); }
      ctx.fillStyle = color('--muted'); ctx.fillText(this.channels.length === 1 ? 'MONO' : this.channels.length === 2 ? ['L', 'R'][c] : `CH ${c + 1}`, 9, top + 18); if (channelHeight > 160) { ctx.fillText('1.0', 17, Math.max(top + 40, mid - amplitude + 4)); ctx.fillText('−1.0', 12, mid + amplitude); } ctx.fillText('0', 28, mid + 4);
      const levels = this.peaks?.[c];
      const samplesPerPixel = span * this.sampleRate / width;
      const level = levels?.[Math.max(0, Math.min(levels.length - 1, Math.floor(Math.log2(samplesPerPixel / 128))))];
      // One closed silhouette avoids rasterizing thousands of overlapping tall strokes.
      const silhouette = new Path2D(), bottom = [];
      ctx.strokeStyle = color('--accent');
      for (let x = 0; x < width; x++) {
        const a = Math.floor((this.offset + x / width * span) * this.sampleRate), b = Math.min(channel.length, Math.max(a + 1, Math.floor((this.offset + (x + 1) / width * span) * this.sampleRate)));
        let lo = Infinity, hi = -Infinity;
        if (b - a >= 128 && level) { for (let j = Math.floor(a / level.size); j <= Math.min(level.min.length - 1, Math.floor((b - 1) / level.size)); j++) { lo = Math.min(lo, level.min[j]); hi = Math.max(hi, level.max[j]); } }
        else if (b - a < 128) for (let j = a; j < b; j++) { lo = Math.min(lo, channel[j]); hi = Math.max(hi, channel[j]); }
        if (!Number.isFinite(lo)) continue;
        const px = left + x + .5, high = mid - clamp(hi, -1, 1) * amplitude - .4;
        if (!bottom.length) silhouette.moveTo(px, high); else silhouette.lineTo(px, high);
        bottom.push(px, mid - clamp(lo, -1, 1) * amplitude + .4);
      }
      for (let i = bottom.length - 2; i >= 0; i -= 2) silhouette.lineTo(bottom[i], bottom[i + 1]);
      silhouette.closePath(); ctx.fillStyle = color('--accent');
      if (this.loopHighlight && this.loopRegions.length) {
        ctx.globalAlpha = .2; ctx.fill(silhouette); ctx.globalAlpha = 1;
        ctx.save(); ctx.beginPath();
        for (const region of this.loopRegions) {
          const a = clamp(left + (region.start - this.offset) / span * width, left, w), b = clamp(left + (region.end - this.offset) / span * width, left, w);
          if (b > a) ctx.rect(a, top, b - a, channelHeight);
        }
        ctx.clip(); ctx.fill(silhouette); ctx.restore();
      } else ctx.fill(silhouette);
      ctx.strokeStyle = color('--panel-border'); ctx.strokeRect(left, top, width, channelHeight);
    });
    this.layoutLoops(left, width, span);
    }
    ctx = overlay.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (this.hasSelection) {
      const a = clamp(left + (this.selection[0] - this.offset) / span * width, left, w), b = clamp(left + (this.selection[1] - this.offset) / span * width, left, w);
      ctx.fillStyle = color('--audio-selection'); ctx.globalAlpha = .30; ctx.fillRect(a, 28, b - a, h - 28); ctx.globalAlpha = 1; ctx.strokeStyle = color('--audio-selection'); ctx.lineWidth = 2;
      for (const x of [a, b]) { ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, h); ctx.stroke(); ctx.fillStyle = color('--audio-selection'); ctx.fillRect(x - 4, 28, 8, 10); }
    }
    for (const [i, id] of ['selection-start', 'selection-end'].entries()) {
      const handle = this.$(id), x = left + (this.selection[i] - this.offset) / span * width;
      handle.hidden = !this.hasSelection || x < left || x > w;
      handle.style.left = (x - 8) + 'px'; handle.title = (i ? 'Selection end: ' : 'Selection start: ') + time(this.selection[i]);
    }
    this.updatePlayhead();
  }
  snapshot() { const loopRegions = this.loopRegions || []; return { channels: this.channels, selection: [...this.selection], cursor: this.cursor, loopRegions: [...loopRegions], activeLoopIndex: loopRegions.indexOf(this.activeLoop), loopHighlight: Boolean(this.loopHighlight), loop: Boolean(this.loop) }; }
  remember() {
    this.history.push(this.snapshot()); this.future = [];
    let bytes = this.channels[0].length * this.channels.length * 4;
    while (this.history.length > 1 && (this.history.length > 16 || bytes + this.history.reduce((sum, item) => sum + item.channels[0].length * item.channels.length * 4, 0) > MAX_AUDIO_BYTES)) this.history.shift();
  }
  restore(from, to) {
    if (!from.length) return; this.stop(false); to.push(this.snapshot()); const item = from.pop(); this.channels = item.channels; this.selection = item.selection; this.cursor = clamp(item.cursor, 0, this.duration); this.loopRegions = item.loopRegions; this.activeLoop = this.loopRegions[item.activeLoopIndex] || null; this.loopHighlight = item.loopHighlight; this.loop = item.loop; this.refresh(null, { preserveLoops: true });
  }
  replace(channels, a, b) {
    const start = Math.round(a * this.sampleRate), end = Math.round(b * this.sampleRate), frames = this.channels[0].length - (end - start) + channels[0].length;
    if (frames * this.channels.length * 4 > MAX_AUDIO_BYTES) throw new Error('Result exceeds the 256 MB decoded limit.');
    if (!frames) throw new Error('Cannot delete the entire audio file.');
    const replacement = this.channels.map((channel, i) => { const data = new Float32Array(frames); data.set(channel.subarray(0, start)); data.set(channels[i], start); data.set(channel.subarray(end), start + channels[i].length); return data; });
    this.remember(); this.channels = replacement; this.selection = [a, a + channels[0].length / this.sampleRate]; this.cursor = a; this.$('loops').replaceChildren(); this.refresh();
  }
  extract(a, b) { return this.channels.map(channel => channel.slice(Math.round(a * this.sampleRate), Math.round(b * this.sampleRate))); }
  async job(label, callback) {
    if (this.working || !this.channels) return;
    this.timeline?.stop();
    this.working = true; this.stop(false); this.setBusy(true, label); this.$('state').textContent = label;
    const disabled = [...this.host.querySelectorAll('button,input,select')].map(node => [node, node.disabled]); disabled.forEach(([node]) => node.disabled = true);
    try { return await callback(); } catch (error) { this.message(error.message); }
    finally { disabled.forEach(([node, value]) => node.disabled = value); this.working = false; this.timeline?.syncControls(); this.syncSaveControls(); this.setBusy(false); this.$('state').textContent = this.dirty ? 'Edited · Ctrl+S to save' : 'Ready'; if (this.channels) { this.$('clear-loops').disabled = !this.loopRegions.length; this.$('undo').disabled = !this.history.length; this.$('redo').disabled = !this.future.length; this.$('trim').disabled = this.$('delete').disabled = this.$('fade-selection-in').disabled = this.$('fade-selection-out').disabled = !this.hasSelection; } }
  }
  async effect(effect) {
    if (!window.desktop?.processAudio) return this.message('Audio effects require the installed desktop application.');
    const input = this.$(effect.startsWith('fade-') ? 'fade' : effect);
    if (input?.type === 'number' && !input.reportValidity()) return;
    await this.job('Processing audio…', async () => {
      clearTimeout(this.previewTimer); this.preview?.stop();
      const [a, b] = this.preview?.range || this.range, value = input?.type === 'number' ? Number(input.value) : 50;
      const processed = this.preview?.effect === effect ? await this.preview.render(value) : decodeWave(await window.desktop.processAudio({ data: encodeWave(this.extract(a, b), this.sampleRate), effect, value }));
      if (!processed) return;
      if (processed.channels.length !== this.channels.length || processed.sampleRate !== this.sampleRate) throw new Error('Audio format changed unexpectedly.');
      this.replace(processed.channels, a, b); this.$('effect-dialog').close();
    });
  }
  async command(action) {
    if (!this.channels || this.working) return;
    if (this.timeline && !this.timeline.clips.length && (action === 'save' || action === 'export' || action.startsWith('export:'))) return;
    if (action.startsWith('timeline:')) {
      const operation = action.slice(9);
      if (operation === 'remove') return this.timeline.removeLayer(this.timeline.contextLayer);
      if (operation === 'duplicate') return this.timeline.duplicate();
      if (operation === 'split') return this.timeline.split();
    }
    const mixPlayback = this.timeline && (this.timeline.source || (!this.source && !this.hasSelection && !this.activeLoop && (!this.timeline.element.hidden || this.timeline.clips.length !== 1 || this.timeline.active?.trimStart || this.timeline.active?.trimEnd !== undefined || this.timeline.active?.start)));
    if (action === 'play' && mixPlayback) return this.timeline.play().catch(error => this.message(error.message));
    if (action === 'stop' || action === 'start') this.timeline?.stop();
    if (action === 'loop' && this.timeline?.source) { this.timeline.mixStarted = this.context.currentTime - this.timeline.mixCursor; this.loop = !this.loop; this.timeline.source.loop = this.loop; this.$('loop').setAttribute('aria-pressed', String(this.loop)); return; }
    if (action === 'save') return this.saveChanges();
    if (action === 'play') return this.play().catch(error => this.message(error.message));
    if (action === 'stop') return this.stop();
    if (action === 'start') { this.stop(false); this.cursor = this.activeLoop?.start || 0; this.select(this.cursor, this.cursor, false); return; }
    if (action === 'loop' && this.activeLoop) return this.releaseLoop();
    if (action === 'loop') { const playing = Boolean(this.source); this.stop(false); this.loop = !this.loop; if (!this.loop) { this.loopHighlight = false; this.draw(); } this.$('loop').setAttribute('aria-pressed', String(this.loop)); if (playing) return this.play(); return; }
    if (action.startsWith('fade-selection-')) return this.fadeSelection(action.endsWith('-in') ? 'in' : 'out');
    if (action === 'undo') return this.restore(this.history, this.future);
    if (action === 'redo') return this.restore(this.future, this.history);
    if (action === 'all') return this.select(0, this.duration);
    if (action === 'clear') return this.select(this.cursor, this.cursor);
    if (action === 'in' || action === 'out') { const at = this.position(); this.stop(false); return this.select(action === 'in' ? at : this.selection[0], action === 'out' ? at : Math.max(at, this.selection[1])); }
    if (['fade-in', 'fade-out', 'chorus'].includes(action)) return this.showEffect(action);
    if (action === 'reverse') return this.effect(action);
    if (action === 'trim' || action === 'delete') {
      if (!this.hasSelection) return;
      return this.job('Editing audio…', async () => {
        const [a, b] = this.selection;
        if (action === 'delete') this.replace(this.channels.map(() => new Float32Array(0)), a, b);
        else { const extracted = this.extract(a, b); this.remember(); this.channels = extracted; this.cursor = 0; this.selection = [0, this.duration]; this.offset = 0; this.zoom = 1; this.$('loops').replaceChildren(); this.refresh(); }
      });
    }
    if (action === 'clear-loops') { if (this.activeLoop) this.releaseLoop(); this.loopHighlight = false; this.loopRegions = []; this.$('loops').replaceChildren(); this.$('clear-loops').disabled = true; this.draw(); return; }
    if (action === 'find-loops') return this.findLoops();
    if (action.startsWith('effect:')) return this.showEffect(action.slice(7));
    if (action === 'export-loop') {
      if (!this.contextLoop || !this.loopRegions.includes(this.contextLoop)) return;
      this.exportRange = [this.contextLoop.start, this.contextLoop.end];
      this.contextLoop = null;
      return this.openExportDialog();
    }
    if (action === 'export' || action.startsWith('export:')) { this.exportRange = null; return this.openExportDialog(action.startsWith('export:') ? action.slice(7) : null); }
  }
  openExportDialog(format = null) {
    this.$('format').value = format || (audioFormats.includes(this.saveFormat) ? this.saveFormat : 'wav');
    this.exportQuality();
    this.$('export-selection').disabled = Boolean(this.exportRange) || !this.hasSelection;
    this.$('export-selection').checked = Boolean(this.exportRange) || this.hasSelection;
    this.$('export-dialog').showModal();
  }
  async findLoops() {
    await this.job('Finding loop regions…', async () => {
      const worker = this.worker = new Worker(new URL('../workers/audioLoops.mjs', import.meta.url), { type: 'module' });
      try {
        const report = await new Promise((resolve, reject) => { worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data); worker.onerror = event => reject(new Error(event.message)); worker.postMessage({ channels: this.channels, sampleRate: this.sampleRate, range: this.range }); });
        const results = report.loops;
        if (this.activeLoop) this.releaseLoop(false);
        this.loopRegions = results; this.loopHighlight = Boolean(results.length); this.waveKey = null; this.$('clear-loops').disabled = !results.length;
        this.draw();
        if (!results.length) this.message(report.reason);
      } finally { worker.terminate(); this.worker = null; }
    });
  }
  layoutLoops(left, width, span) {
    const host = this.$('loops'), existing = new Map([...host.children].map(button => [Number(button.dataset.loopIndex), button]));
    for (const [i, result] of this.loopRegions.entries()) {
      if (result.end < this.offset || result.start > this.offset + span) continue;
      const start = clamp((result.start - this.offset) / span, 0, 1), end = clamp((result.end - this.offset) / span, 0, 1);
      const region = existing.get(i) || document.createElement('button'); existing.delete(i); region.className = 'audio-loop-region';
      region.style.left = `${left + start * width}px`; region.style.width = `${Math.max(1, (end - start) * width)}px`; region.style.top = '32px'; region.dataset.loopIndex = i; region.setAttribute('aria-pressed', String(result === this.activeLoop));
      region.textContent = `Loop ${i + 1}`; region.title = `Loop ${i + 1}: ${time(result.start)} — ${time(result.end)}\n${result.bpm.toFixed(1)} BPM · ${result.bars} bars · estimated ${result.beatsPerBar} beats/bar\nJoin level mismatch: ${(result.levelError * 100).toFixed(1)}% of local RMS\nClick to lock playback; click again to release.`;
      region.onpointerdown = event => { if (event.button !== 1) event.stopPropagation(); };
      region.onclick = () => this.chooseLoop(result);
      region.oncontextmenu = event => {
        event.preventDefault(); event.stopPropagation();
        if (this.working) return;
        this.contextLoop = result;
        void window.desktop?.contextMenu({ mediaType: 'audio', loopRegion: true }).catch(error => this.message(error.message));
      };
      if (!region.parentNode) host.append(region);
    }
    for (const region of existing.values()) region.remove();
  }
  showEffect(effect) {
    const fields = { gain: ['Volume (%)', 0, 1600, 100, 1], pitch: ['Pitch (semitones)', -24, 24, 0, .1], stretch: ['Time stretch (%)', 25, 400, 100, 1], distortion: ['Distortion (%)', 0, 100, 25, 1], smooth: ['Smoothness (%)', 0, 100, 40, 1], 'fade-in': ['Fade in (s)', .001, Math.min(600, this.range[1] - this.range[0]), .1, .001], 'fade-out': ['Fade out (s)', .001, Math.min(600, this.range[1] - this.range[0]), .1, .001], chorus: ['Chorus (%)', 0, 100, 50, 1] };
    const spec = fields[effect]; if (!spec) return;
    this.stop(false); this.closePreview();
    this.currentEffect = effect; this.$('effect-title').textContent = spec[0];
    const id = effect.startsWith('fade-') ? 'fade' : effect;
    spec[3] = Math.min(spec[3], spec[2]);
    this.$('effect-fields').innerHTML = `${field(id, ...spec)}<input id="audio-effect-slider" type="range" aria-label="${spec[0]} slider" min="${spec[1]}" max="${spec[2]}" value="${spec[3]}" step="${spec[4]}">`;
    this.nodes.delete(id); this.nodes.delete('effect-slider');
    this.context ||= new AudioContext();
    const range = [...this.range];
    this.preview = new AudioEffectPreview({ channels: this.extract(...range), sampleRate: this.sampleRate, effect, context: this.context,
      process: async payload => decodeWave(await window.desktop.processAudio(payload)),
      changed: state => {
        for (const mode of ['before', 'after']) this.$(`preview-${mode}`).setAttribute('aria-pressed', String(state.mode === mode));
        this.$('preview-stop').disabled = !state.mode;
        this.$('preview-status').textContent = state.error || (state.pending ? 'Preparing preview…' : state.mode ? `Preview: ${state.mode === 'before' ? 'before' : 'after'} · looping range` : 'Changes are made only when you apply the effect.');
      }
    });
    this.preview.range = range;
    const update = () => { clearTimeout(this.previewTimer); if (this.preview?.mode === 'after') { if (effect === 'gain' && this.preview.gain) this.preview.updateGain(this.effectValue()); else this.previewTimer = setTimeout(() => void this.preview?.audition('after', this.effectValue()), 200); } };
    this.$(id).required = true;
    this.$(id).oninput = () => { if (this.$(id).validity.valid) { this.$('effect-slider').value = this.$(id).value; update(); } };
    this.$('effect-slider').oninput = () => { this.$(id).value = this.$('effect-slider').value; update(); };
    this.$('effect-dialog').showModal(); this.$(id)?.focus();
  }
  effectValue() { return Number(this.$(this.currentEffect.startsWith('fade-') ? 'fade' : this.currentEffect).value); }
  closePreview() { clearTimeout(this.previewTimer); this.preview?.close(); this.preview = null; }
  exportQuality() {
    const format = this.$('format').value, q = ['standard', 'high', 'maximum'].indexOf(this.$('quality').value);
    const descriptions = { wav: ['16-bit PCM', '24-bit PCM', '32-bit float'], aiff: ['16-bit PCM', '24-bit PCM', '24-bit PCM'], flac: ['16-bit lossless', '24-bit lossless', '24-bit lossless'], mp3: ['128 kbps', '192 kbps', '320 kbps'], ogg: ['Vorbis Q4', 'Vorbis Q6', 'Vorbis Q10'], opus: ['96 kbps', '160 kbps', '256 kbps'], ac3: ['192 kbps', '384 kbps', '640 kbps'] };
    this.$('quality-help').textContent = (descriptions[format] || ['128 kbps', '192 kbps', '320 kbps'])[q];
    this.$('quality-slider').value = String(q);
    this.$('quality-slider').setAttribute('aria-valuetext', this.$('quality').selectedOptions[0].textContent);
    this.$('quality-slider').style.setProperty('--range-fill', `${q * 50}%`);
    const bitrates = { mp3: [128, 192, 320], m4a: [128, 192, 320], aac: [128, 192, 320], opus: [96, 160, 256], wma: [128, 192, 320], ac3: [192, 384, 640] };
    this.$('bitrate-fields').hidden = !bitrates[format];
    if (bitrates[format]) { const input = this.$('bitrate'); input.min = format === 'ac3' ? 192 : 64; input.max = format === 'ac3' ? 640 : 320; input.step = format === 'ac3' ? 64 : 32; input.value = bitrates[format][q]; }
    this.syncExportSliders?.();
    const rates = format === 'opus' ? [0, 48000] : format === 'ac3' ? [0, 44100, 48000] : ['mp3', 'wma'].includes(format) ? [0, 22050, 44100, 48000] : [0, 22050, 44100, 48000, 96000];
    this.$('rate').options[0].textContent = 'Automatic (source if supported)';
    for (const option of this.$('rate').options) option.disabled = !rates.includes(Number(option.value));
    if (!rates.includes(Number(this.$('rate').value))) this.$('rate').value = '0';
  }
  acceptSave(saved) {
    this.savedChannels = this.channels;
    this.timeline?.markSaved();
    this.name = saved.name || saved; this.documentId = saved.documentId || this.documentId;
    this.saveFormat = this.name.split('.').pop().toLowerCase(); this.host.dataset.name = this.name;
    this.changed?.();
  }
  async saveChanges() {
    return Boolean(await this.job('Saving changes…', async () => {
      const mixed = this.timeline ? await this.timeline.mix() : { channels: this.channels, sampleRate: this.sampleRate };
      const data = encodeWave(mixed.channels, mixed.sampleRate);
      if (!window.desktop?.exportAudio) throw new Error('Saving requires the installed desktop application.');
      const format = audioFormats.includes(this.saveFormat) ? this.saveFormat : 'wav';
      const saved = await window.desktop.exportAudio({ data, documentId: this.documentId, overwrite: !this.timeline || (this.timeline.clips.length === 1 && this.timeline.clips[0].start === 0), name: this.name, format, quality: 'maximum', sampleRate: 0 });
      if (!saved) return false;
      this.acceptSave(saved); this.message(`Saved ${this.name}`);
      return true;
    }));
  }
  async save() {
    const range = this.exportRange || (this.$('export-selection').checked && this.hasSelection ? this.selection : null);
    const selected = Boolean(range), format = this.$('format').value, quality = this.$('quality').value, sampleRate = Number(this.$('rate').value);
    await this.job('Exporting audio…', async () => {
      const mixed = selected ? { channels: this.extract(...range), sampleRate: this.sampleRate } : this.timeline ? await this.timeline.mix() : { channels: this.channels, sampleRate: this.sampleRate };
      const data = encodeWave(mixed.channels, mixed.sampleRate);
      if (!window.desktop?.exportAudio) throw new Error('Conversion and Save as require the installed desktop application.');
      const saved = await window.desktop.exportAudio({ data, documentId: this.documentId, selectionOnly: selected, name: this.name, format, quality, sampleRate, bitrate: this.$('bitrate-fields').hidden ? undefined : Number(this.$('bitrate').value) });
      if (saved) { this.$('export-dialog').close(); if (!selected) this.acceptSave(saved); this.message(`Saved ${saved.name || saved}`); }
    });
  }
  key(event) {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD' && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) && !event.target.isContentEditable && !document.querySelector('dialog[open]')) {
      event.preventDefault(); if (!this.working && this.timeline && !this.timeline.element.hidden) { if (event.shiftKey) this.timeline.split(); else this.timeline.duplicate(); } return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyS' || event.key.toLowerCase() === 's')) {
      event.preventDefault();
      if (!this.working && !document.querySelector('dialog[open]')) void this.command(event.shiftKey ? 'export' : 'save');
      return;
    }
    if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) || event.target.isContentEditable || this.working || document.querySelector('dialog[open]')) return;
    const modifier = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    const action = modifier ? ({ z: event.shiftKey ? 'redo' : 'undo', y: 'redo', a: 'all', s: event.shiftKey ? 'export' : 'save' }[key]) : ({ ' ': 'play', escape: 'stop', home: 'start', l: 'loop', i: 'in', o: 'out', delete: 'delete' }[key]);
    if (action) { event.preventDefault(); void this.command(action); }
  }
  deactivate() { this.timeline?.stop(); this.closePreview(); this.stop(); }
  dispose() { this.timeline?.dispose(); this.unbindWavePan?.(); this.closePreview(); this.disposed = true; cancelAnimationFrame(this.drawFrame); for (const cancel of this.dataWorkers?.values() || []) cancel(); this.stop(); this.worker?.terminate(); this.resize.disconnect(); void this.context?.close(); }
}

import { toolButton, toolIcon, sliderFieldMarkup, bindSliderFields } from './Controls.mjs';
import { VideoCropOverlay } from './VideoCropOverlay.mjs';
import { audioFormats } from '../../shared/mediaTypes.mjs';
import { ResizablePanel } from '../managers/ResizablePanel.mjs';
import { videoProfiles, codecLabels, videoOptions, videoGeometry, estimateVideoBytes } from '../../shared/video.mjs';

const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`;
const bytes = value => `${(value / 1024 / 1024).toFixed(1)} MB`;
export class VideoWorkspace {
  constructor(host, { message, busy }) {
    this.host = host; this.message = message; this.busy = busy;
    const field = (key, label, value, min, max, step = 1) => sliderFieldMarkup(`video-${key}`, label, min, max, value, step, `data-option="${key}" ${key === 'bitrate' ? 'data-slider-scale="log"' : ''}`);
    const button = (action, label, icon, extra = '') => toolButton({ label, icon, attributes: `type="button" data-${action} ${extra}` });
    host.innerHTML = `<div class="video-main">
      <div class="video-toolbar media-toolbar tools" role="toolbar" aria-label="Video tools">
        <div class="media-tool-group">${button('edit', 'Edit settings', 'adjustments-horizontal', 'aria-expanded="false" aria-controls="video-settings"')}${button('crop-edit', 'Edit crop on video', 'crop', 'aria-pressed="false"')}<span class="media-divider"></span>${button('mute', 'Mute audio', 'volume', 'aria-pressed="false"')}<input data-volume type="range" min="0" max="1" value="1" step="0.01" aria-label="Volume"><span class="media-divider"></span>${button('start', 'Go to start (Home)', 'player-skip-back')}${button('play', 'Play / Pause (Space)', 'player-play', 'aria-pressed="false"')}${button('stop', 'Stop (Esc)', 'player-stop')}${button('loop', 'Loop playback (L)', 'repeat', 'aria-pressed="false"')}</div>
      </div>
      <div class="video-stage"><div class="video-picture"><canvas aria-label="Video output preview"></canvas><div class="video-crop-overlay" hidden></div></div><video playsinline preload="auto" hidden></video></div>
      <div class="video-seek"><input data-seek type="range" min="0" max="1" value="0" step="0.01" aria-label="Video position"></div>
      <div class="media-status"><span data-state role="status">Ready</span><output data-clock aria-label="Current playback time">00:00.000 / 00:00.000</output><span data-info></span></div>
    </div>
    <div class="resize-handle vertical video-divider" role="separator" tabindex="0" aria-label="Resize video settings" aria-orientation="vertical"></div>
    <aside id="video-settings" class="video-settings" aria-label="Video settings"><div class="media-panel-heading tools"><h2>Video settings</h2>${button('close-settings', 'Hide video settings', 'chevron-right')}</div><form>
      <div class="video-settings-scroll">
        <section class="inspector-section"><h3>Encoding</h3><label class="inspector-field"><span>Container</span><select data-option="format">${Object.entries(videoProfiles).map(([key, p]) => `<option value="${key}">${p.label}</option>`).join('')}</select></label><label class="inspector-field"><span>Codec</span><select data-option="codec"></select></label>${sliderFieldMarkup('video-quality', 'Video quality (%)', 0, 100, 60, 1, 'data-quality')}<p data-quality-help class="inspector-note"></p>${field('bitrate', 'Bitrate (kbps)', 4000, 100, 200000, 100)}${field('fps', 'FPS', 30, 1, 120, .001)}</section>
        <section class="inspector-section"><h3>Output size</h3>${field('width', 'Width (px)', 1920, 16, 7680, 2)}${field('height', 'Height (px)', 1080, 16, 4320, 2)}<label class="inspector-field"><span>Resize mode</span><select data-option="mode"><option value="fit">Fit</option><option value="fill">Fill</option></select></label></section>
        <section class="inspector-section"><h3>Crop source (px)</h3><div class="video-crop-actions"><button type="button" data-crop-toggle>Edit on video</button><button type="button" data-crop-reset>Reset crop</button></div>${['left', 'right', 'top', 'bottom'].map(k => field(k, k[0].toUpperCase() + k.slice(1), 0, 0, 32768)).join('')}</section>
        <section class="inspector-section"><h3>Audio</h3><label class="check"><input data-option="audio" type="checkbox" checked>Include audio</label>${field('audioBitrate', 'Audio quality (kbps)', 192, 64, 320, 32)}<label class="inspector-field"><span>Sample rate</span><select data-option="audioRate"><option value="44100">44,100 Hz</option><option value="48000" selected>48,000 Hz</option></select></label><label class="inspector-field"><span>Channels</span><select data-option="audioChannels"><option value="1">Mono</option><option value="2" selected>Stereo</option></select></label></section>
      </div>
      <div class="video-export-status"><span>Estimated size</span><output data-estimate role="status" title="Approximate size from duration and bitrate. Actual size depends on content and codec.">—</output><p data-error role="alert" hidden></p></div>
      <div class="video-export-actions"><button type="button" data-reset>Reset</button><button type="submit" class="primary" data-export>Export…</button></div>
    </form></aside><div class="video-panel-toggle tools">${button('open-settings', 'Show video settings', 'chevron-left', 'aria-expanded="false" aria-controls="video-settings"')}</div>`;
    this.$ = selector => host.querySelector(selector); this.video = this.$('video'); this.canvas = this.$('canvas');
    this.syncSliders = bindSliderFields(host);
    this.cropOverlay = new VideoCropOverlay(this.$('.video-crop-overlay'), { info: () => this.descriptor.info, get: () => this.cropValues(), set: crop => this.setCrop(crop) });
    this.$('[data-crop-edit]').onclick = this.$('[data-crop-toggle]').onclick = () => this.toggleCrop();
    this.$('[data-crop-reset]').onclick = () => this.setCrop({ left: 0, right: 0, top: 0, bottom: 0 });
    this.$('.video-stage').oncontextmenu = event => { event.preventDefault(); void window.desktop?.contextMenu({ mediaType: 'video', loop: this.video.loop, hasAudio: this.descriptor?.info.hasAudio }).catch(error => this.message(error.message)); };
    this.panelSize = new ResizablePanel({ handle: this.$('.video-divider'), panel: this.$('aside'), key: 'video', axis: 'x', initial: 280, limits: () => [240, Math.max(240, Math.min(480, host.clientWidth - 320))] });
    this.showSettings(false);
    this.$('[data-edit]').onclick = () => this.showSettings(this.$('aside').hidden);
    this.$('[data-open-settings]').onclick = () => this.showSettings(true);
    this.$('[data-close-settings]').onclick = () => this.showSettings(false);
    this.$('[data-start]').onclick = () => { this.video.currentTime = 0; this.draw(); };
    this.$('[data-loop]').onclick = () => { this.video.loop = !this.video.loop; this.playbackUI(); };
    this.$('[data-mute]').onclick = () => { this.video.muted = !this.video.muted; this.playbackUI(); };
    this.$('[data-option="format"]').onchange = () => { this.codecs(); this.update(); };
    this.$('form').oninput = e => { if (e.target.dataset.option === 'bitrate') this.customBitrate = true; if (e.target.matches('[data-quality]')) this.customBitrate = false; if (e.target.matches('[data-quality]') || ['width', 'height', 'fps'].includes(e.target.dataset.option)) this.quality(); this.update(); };
    this.$('form').onsubmit = e => { e.preventDefault(); void this.export(); };
    this.$('[data-reset]').onclick = () => this.reset();
    this.$('[data-play]').onclick = () => this.toggle(); this.$('[data-stop]').onclick = () => this.stop();
    this.$('[data-seek]').oninput = e => { this.video.currentTime = Number(e.target.value); };
    this.$('[data-volume]').oninput = e => { this.video.volume = Number(e.target.value); this.video.muted = false; this.playbackUI(); };
    this.video.onplay = () => { this.pendingAutoplay = false; this.playbackUI(); cancelAnimationFrame(this.frame); this.tick(); };
    this.video.onpause = this.video.onended = () => { this.playbackUI(); cancelAnimationFrame(this.frame); this.draw(); };
    this.video.onseeked = () => this.draw();
    this.video.onloadeddata = () => { this.playbackUI(); this.draw(); if (this.pendingAutoplay && !this.host.hidden) { this.pendingAutoplay = false; void this.play(); } };
    this.video.onerror = () => void this.fallback();
    this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(this.$('.video-stage'));
    this.codecs();
  }
  codecs() {
    const format = this.$('[data-option="format"]').value;
    this.$('[data-option="codec"]').innerHTML = videoProfiles[format].codecs.map(c => `<option value="${c}">${codecLabels[c]}</option>`).join('');
  }
  async load(descriptor) {
    if (descriptor.info) return descriptor;
    const source = descriptor.assets?.find(a => a.name === descriptor.name)?.url || descriptor.url;
    const url = URL.createObjectURL(await (await fetch(source)).blob());
    const video = document.createElement('video'); video.preload = 'metadata';
    try { await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('This video requires FFmpeg in the desktop app.')); video.src = url; });
      return { ...descriptor, url, ownedURL: true, info: { width: video.videoWidth, height: video.videoHeight, duration: video.duration, fps: 30 } };
    } catch (error) { URL.revokeObjectURL(url); throw error;
    } finally { video.removeAttribute('src'); video.load(); }
  }
  install(descriptor, name) {
    this.deactivate(); if (this.descriptor?.ownedURL) URL.revokeObjectURL(this.descriptor.url); this.descriptor = descriptor; this.fallbackUsed = false; this.pendingAutoplay = this.desiredPlayback = true;
    this.video.src = descriptor.url; this.$('[data-seek]').max = descriptor.info.duration;
    this.showSettings(false); this.reset(); this.playbackUI(); document.title = `${name} — CationMedia`;
  }
  reset() {
    if (!this.descriptor) return; const info = this.descriptor.info;
    const values = { format: 'mp4', width: Math.min(7680, Math.max(16, Math.round(info.width / 2) * 2)), height: Math.min(4320, Math.max(16, Math.round(info.height / 2) * 2)), fps: Math.min(120, Math.max(1, info.fps)), mode: 'fit', left: 0, right: 0, top: 0, bottom: 0, audioBitrate: 192, audioRate: 48000, audioChannels: 2 };
    for (const [key, value] of Object.entries(values)) this.$(`[data-option="${key}"]`).value = value;
    this.$('[data-option="audio"]').checked = info.hasAudio !== false;
    this.$('[data-option="audio"]').disabled = info.hasAudio === false;
    this.$('[data-quality]').value = '60'; this.customBitrate = false; this.cropEditing = false; this.$('.video-crop-overlay').hidden = true; this.$('[data-crop-edit]').setAttribute('aria-pressed', 'false'); this.$('[data-crop-toggle]').textContent = 'Edit on video'; this.codecs(); this.quality(); this.update();
  }
  quality() {
    const q = 2 ** ((Number(this.$('[data-quality]').value) - 60) / 30); if (this.customBitrate) return;
    const get = key => Number(this.$(`[data-option="${key}"]`).value);
    this.$('[data-option="bitrate"]').value = Math.min(200000, Math.max(100, Math.round(get('width') * get('height') * get('fps') * .075 * q / 100000) * 100));
  }
  options() {
    const raw = Object.fromEntries([...this.host.querySelectorAll('[data-option]')].map(node => [node.dataset.option, node.type === 'checkbox' ? node.checked : node.value]));
    raw.crop = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key => [key, raw[key]]));
    raw.quality = 2 ** ((Number(this.$('[data-quality]').value) - 60) / 30);
    return videoOptions(raw, this.descriptor.info);
  }
  update() {
    if (!this.descriptor) return;
    const crop = this.cropValues(), info = this.descriptor.info;
    for (const [edge, opposite, dimension] of [['left', 'right', 'width'], ['right', 'left', 'width'], ['top', 'bottom', 'height'], ['bottom', 'top', 'height']]) this.$(`[data-option="${edge}"]`).max = Math.max(0, info[dimension] - crop[opposite] - 2);
    this.$('[data-option="fps"]').dataset.sliderStep = '1';
    const prores = this.$('[data-option="codec"]').value === 'prores_ks';
    this.$('[data-option="bitrate"]').disabled = prores;
    this.$('[data-quality-help]').textContent = prores ? (Number(this.$('[data-quality]').value) < 51 ? 'ProRes Proxy' : Number(this.$('[data-quality]').value) > 74 ? 'ProRes HQ' : 'ProRes 422') : this.customBitrate ? 'Custom target bitrate' : `${this.$('[data-option="bitrate"]').value} kbps target`;
    const audio = this.$('[data-option="audio"]').checked;
    for (const key of ['audioBitrate', 'audioRate', 'audioChannels']) this.$(`[data-option="${key}"]`).disabled = !audio;
    const opus = videoProfiles[this.$('[data-option="format"]').value].audio === 'libopus';
    this.$('[data-option="audioRate"] option[value="44100"]').disabled = opus;
    if (opus) this.$('[data-option="audioRate"]').value = '48000';
    this.syncSliders();
    try { this.options(); this.$('[data-error]').textContent = ''; this.$('[data-error]').hidden = true; this.$('[data-export]').disabled = false; this.$('[data-estimate]').textContent = `≈ ${bytes(estimateVideoBytes(this.options(), this.descriptor.info.duration))}`; this.draw(); }
    catch (error) { this.$('[data-error]').textContent = error.message; this.$('[data-error]').hidden = false; this.$('[data-export]').disabled = true; this.$('[data-estimate]').textContent = '—'; }
  }
  draw() {
    if (!this.descriptor || this.host.hidden || this.video.readyState < 2) return;
    let options; try { options = this.options(); } catch { return; }
    const { width, height } = this.cropEditing ? this.descriptor.info : options, stage = this.$('.video-stage'), scale = Math.min((stage.clientWidth - 24) / width, (stage.clientHeight - 24) / height, 1);
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.$('.video-picture').style.width = `${w}px`; this.$('.video-picture').style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d'), g = videoGeometry(options, this.descriptor.info);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const rx = this.video.videoWidth / this.descriptor.info.width, ry = this.video.videoHeight / this.descriptor.info.height;
    if (this.cropEditing) { ctx.drawImage(this.video, 0, 0, w, h); this.cropOverlay.draw(); }
    else ctx.drawImage(this.video, g.sx * rx, g.sy * ry, g.sw * rx, g.sh * ry, g.dx * w / width, g.dy * h / height, g.dw * w / width, g.dh * h / height);
    this.$('[data-clock]').textContent = `${formatTime(this.video.currentTime)} / ${formatTime(this.descriptor.info.duration)}`; this.$('[data-seek]').value = this.video.currentTime;
  }
  tick() { this.draw(); if (!this.video.paused) this.frame = requestAnimationFrame(() => this.tick()); }
  cropValues() { return Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key => [key, Number(this.$(`[data-option="${key}"]`).value) || 0])); }
  setCrop(crop) { for (const [key, value] of Object.entries(crop)) this.$(`[data-option="${key}"]`).value = value; this.update(); }
  toggleCrop() {
    this.cropEditing = !this.cropEditing; this.$('.video-crop-overlay').hidden = !this.cropEditing;
    this.$('[data-crop-edit]').setAttribute('aria-pressed', String(this.cropEditing));
    this.$('[data-crop-toggle]').textContent = this.cropEditing ? 'Done' : 'Edit on video'; this.draw();
  }
  command(action) {
    if (action === 'play') return this.toggle(); if (action === 'stop') return this.stop();
    if (action === 'loop') { this.video.loop = !this.video.loop; return this.playbackUI(); }
    if (action === 'settings') return this.showSettings(this.$('aside').hidden);
    if (action === 'crop') return this.toggleCrop();
    if (action === 'frame') return this.saveFrame();
    if (action?.startsWith('audio:')) return this.extractAudio(action.slice(6));
    if (action?.startsWith('export:')) {
      const format = action.slice(7); if (!Object.hasOwn(videoProfiles, format)) return;
      this.$('[data-option="format"]').value = format; this.codecs(); this.update();
    }
    this.showSettings(true); return this.export();
  }
  showSettings(expanded) {
    this.$('.video-panel-toggle').hidden = expanded; this.$('[data-open-settings]').setAttribute('aria-expanded', String(expanded));
    this.$('aside').hidden = !expanded; this.$('.video-divider').hidden = !expanded;
    this.$('[data-edit]').setAttribute('aria-expanded', String(expanded)); this.$('[data-edit]').setAttribute('aria-pressed', String(expanded));
    if (!expanded && this.$('aside').contains(document.activeElement)) this.$('[data-edit]').focus();
    this.draw();
  }
  playbackUI() {
    const playing = !this.video.paused && !this.video.ended;
    this.$('[data-play]').innerHTML = toolIcon(playing ? 'player-pause' : 'player-play');
    this.$('[data-play]').setAttribute('aria-pressed', String(playing));
    this.$('[data-loop]').setAttribute('aria-pressed', String(this.video.loop));
    const muted = this.video.muted || this.video.volume === 0;
    this.$('[data-mute]').innerHTML = toolIcon(muted ? 'volume-off' : 'volume'); this.$('[data-mute]').setAttribute('aria-pressed', String(muted));
    for (const action of ['play', 'stop', 'start']) this.$(`[data-${action}]`).disabled = this.video.readyState < 2;
    this.$('[data-state]').textContent = this.video.readyState < 2 ? 'Loading…' : playing ? 'Playing' : this.video.ended ? 'Ended' : this.video.currentTime > 0 ? 'Paused' : 'Ready';
    if (this.descriptor) { const i = this.descriptor.info; this.$('[data-info]').textContent = `${i.width} × ${i.height}${i.fps ? ` · ${i.fps} FPS` : ''}${i.codec ? ` · ${i.codec.toUpperCase()}` : ''}`; }
  }
  async play() {
    if (this.host.hidden || this.exporting) return;
    this.desiredPlayback = true;
    const descriptor = this.descriptor;
    try { await this.video.play(); }
    catch (error) { if (descriptor !== this.descriptor || this.host.hidden || error.name === 'AbortError' || this.video.error) return; this.playbackUI(); this.message(error.name === 'NotAllowedError' ? 'Press Play to start video; the browser blocked autoplay with sound.' : error.message); }
  }
  toggle() { this.pendingAutoplay = false; if (!this.video.paused) { this.desiredPlayback = false; this.video.pause(); } else void this.play(); }
  stop() { this.pendingAutoplay = this.desiredPlayback = false; this.video.pause(); this.video.currentTime = 0; this.playbackUI(); this.draw(); }
  async fallback() {
    const descriptor = this.descriptor;
    if (this.fallbackUsed || !window.desktop?.videoPreview) return this.message('Video cannot be played with the available decoders.');
    this.fallbackUsed = true; this.pendingAutoplay = this.desiredPlayback; this.busy(true, 'Preparing compatible video preview…');
    try { const url = await window.desktop.videoPreview(descriptor.documentId); if (descriptor === this.descriptor) this.video.src = url; }
    catch (error) { this.message(error.message); } finally { this.busy(false); }
  }
  async saveFrame() {
    if (this.exporting || this.video.readyState < 2) return;
    if (!window.desktop?.saveVideoFrame) return this.message('Saving a frame requires the desktop application.');
    this.pendingAutoplay = this.desiredPlayback = false; this.video.pause(); this.exporting = true;
    this.busy(true, 'Saving video frame…');
    try { const saved = await window.desktop.saveVideoFrame({ documentId: this.descriptor.documentId, time: this.video.currentTime, options: this.options() }); if (saved) this.message(`Saved ${saved.name}`); }
    catch (error) { this.message(error.message); } finally { this.exporting = false; this.busy(false); }
  }
  async extractAudio(format) {
    if (this.exporting || !audioFormats.includes(format)) return;
    if (this.descriptor.info.hasAudio === false) return this.message('This video has no audio track.');
    if (!window.desktop?.extractVideoAudio) return this.message('Audio extraction requires the desktop application.');
    this.pendingAutoplay = this.desiredPlayback = false; this.video.pause(); this.exporting = true; this.busy(true, 'Extracting audio…');
    const bitrate = Number(this.$('[data-option="audioBitrate"]').value);
    try {
      const saved = await window.desktop.extractVideoAudio({ documentId: this.descriptor.documentId, format, quality: 'high', sampleRate: Number(this.$('[data-option="audioRate"]').value), channels: Number(this.$('[data-option="audioChannels"]').value), ...(['mp3', 'm4a', 'aac', 'opus', 'wma'].includes(format) ? { bitrate } : {}) });
      if (saved) this.message(`Saved ${saved.name} · ${bytes(saved.size)}`);
    } catch (error) { this.message(error.message); } finally { this.exporting = false; this.busy(false); }
  }
  async export() {
    if (this.exporting || !this.$('form').reportValidity()) return;
    if (!window.desktop?.exportVideo) return this.message('Video export requires the desktop application.');
    this.pendingAutoplay = this.desiredPlayback = false; this.exporting = true; this.video.pause(); this.busy(true, 'Encoding video…');
    try { const saved = await window.desktop.exportVideo({ documentId: this.descriptor.documentId, options: this.options() }); if (saved) this.message(`Saved ${saved.name} · ${bytes(saved.size)}`); }
    catch (error) { this.message(error.message); } finally { this.exporting = false; this.busy(false); }
  }
  key(event) {
    if (event.defaultPrevented || event.target.isContentEditable || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); this.showSettings(true); void this.export(); return; }
    if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); this.toggle(); }
    if (event.code === 'Escape') { event.preventDefault(); this.stop(); }
    if (event.code === 'Home') { event.preventDefault(); this.video.currentTime = 0; }
    if (event.code === 'KeyL') { event.preventDefault(); this.video.loop = !this.video.loop; this.playbackUI(); }
    if (['ArrowLeft', 'ArrowRight'].includes(event.code)) { event.preventDefault(); this.video.currentTime = Math.max(0, Math.min(this.descriptor.info.duration, this.video.currentTime + (event.code === 'ArrowRight' ? 5 : -5))); }
  }
  deactivate() { this.pendingAutoplay = this.desiredPlayback = false; this.video.pause(); cancelAnimationFrame(this.frame); }
  dispose() { this.deactivate(); this.resize.disconnect(); this.panelSize.dispose(); if (this.descriptor?.ownedURL) URL.revokeObjectURL(this.descriptor.url); this.video.removeAttribute('src'); this.video.load(); }
}

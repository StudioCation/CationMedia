import { encodeWave } from '../../shared/audio.mjs';

// A temporary audition session. Its samples never replace the document until Apply.
export class AudioEffectPreview {
  constructor({ channels, sampleRate, effect, context, process, changed }) {
    Object.assign(this, { channels, sampleRate, effect, context, process, changed });
    this.mode = null; this.request = 0; this.queue = Promise.resolve();
  }
  async render(value) {
    this.latestValue = value;
    if (this.cached?.value === value) return this.cached.result;
    if (this.pending?.value === value) return this.pending.promise;
    const promise = this.queue.catch(() => {}).then(async () => {
      if (this.closed || value !== this.latestValue) return null;
      this.data ||= encodeWave(this.channels, this.sampleRate);
      const result = await this.process({ data: this.data, effect: this.effect, value });
      if (this.closed) return null;
      if (result.sampleRate !== this.sampleRate || result.channels.length !== this.channels.length) throw new Error('Audio format changed unexpectedly.');
      if (value === this.latestValue) this.cached = { value, result };
      return result;
    });
    this.pending = { value, promise }; this.queue = promise;
    try { return await promise; }
    finally { if (this.pending?.promise === promise) this.pending = null; }
  }
  fraction() {
    return this.source ? ((this.context.currentTime - this.startedAt + this.offset) % this.source.buffer.duration) / this.source.buffer.duration : 0;
  }
  stopSource() { if (this.source) { this.source.stop(); this.source.disconnect(); this.source = null; } this.gain?.disconnect(); this.gain = null; }
  updateGain(value) { if (this.gain) this.gain.gain.setTargetAtTime(value / 100, this.context.currentTime, .008); }
  stop() { this.request++; this.stopSource(); this.mode = null; this.changed?.({ mode: null, pending: false }); }
  async audition(mode, value) {
    const fraction = this.fraction(), request = ++this.request;
    this.stopSource(); this.mode = mode; this.changed?.({ mode, pending: mode === 'after' && this.effect !== 'gain' });
    try {
      await this.context.resume();
      const liveGain = mode === 'after' && this.effect === 'gain';
      const result = mode === 'before' || liveGain ? this : await this.render(value);
      if (!result || this.closed || request !== this.request) return;
      const buffer = this.context.createBuffer(result.channels.length, result.channels[0].length, result.sampleRate);
      result.channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
      const source = this.source = this.context.createBufferSource(); source.buffer = buffer;
      source.loop = true; source.loopEnd = buffer.duration;
      if (liveGain) { this.gain = this.context.createGain(); this.gain.gain.value = value / 100; source.connect(this.gain); this.gain.connect(this.context.destination); }
      else source.connect(this.context.destination);
      this.offset = fraction * buffer.duration; this.startedAt = this.context.currentTime;
      source.start(0, this.offset); this.changed?.({ mode, pending: false });
    } catch (error) {
      if (!this.closed && request === this.request) { this.stop(); this.changed?.({ mode: null, pending: false, error: error.message }); }
    }
  }
  close() { this.closed = true; this.stop(); this.cached = this.data = null; }
}

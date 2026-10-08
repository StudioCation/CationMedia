import { detectMediaType } from '../../shared/mediaTypes.mjs';

export class MediaSession {
  constructor(host, onChange) { this.host = host; this.onChange = onChange; this.adapters = new Map(); this.type = null; }
  register(id, adapter) { this.adapters.set(id, adapter); }
  resolve(name) {
    const type = detectMediaType(name), adapter = this.adapters.get(type?.id);
    if (!adapter) throw new Error('This media format is not supported yet.');
    return { type, adapter };
  }
  activate(type) {
    if (this.type?.id !== type?.id) this.adapters.get(this.type?.id)?.deactivate?.();
    this.type = type; this.host.dataset.mediaType = type?.id || 'home';
    for (const node of this.host.querySelectorAll('[data-media-view]')) node.hidden = node.dataset.mediaView !== (type?.id || 'home');
    for (const node of this.host.querySelectorAll('[data-capability]')) node.hidden = !type?.capabilities.includes(node.dataset.capability);
    this.onChange?.(type);
  }
}

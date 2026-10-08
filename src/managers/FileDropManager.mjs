// One file-drop boundary for the entire document, including panels and controls.
export class FileDropManager {
  constructor(overlay, { busy, files }) {
    this.controller = new AbortController(); this.depth = 0;
    const options = { capture: true, signal: this.controller.signal };
    const isFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
    this.clear = () => { this.depth = 0; overlay.hidden = true; };
    window.addEventListener('dragenter', event => { if (!isFiles(event)) return; event.preventDefault(); this.depth++; overlay.hidden = false; }, options);
    window.addEventListener('dragover', event => { if (!isFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = busy() ? 'none' : 'copy'; }, options);
    window.addEventListener('dragleave', event => { if (!this.depth) return; event.preventDefault(); if (--this.depth <= 0) this.clear(); }, options);
    window.addEventListener('drop', event => { this.clear(); if (!isFiles(event)) return; event.preventDefault(); event.stopPropagation(); if (!busy()) void files(event.dataTransfer.files, event); }, options);
    window.addEventListener('dragend', this.clear, options);
    window.addEventListener('blur', this.clear, options);
    window.addEventListener('keydown', event => { if (event.key === 'Escape') this.clear(); }, options);
  }
  dispose() { this.clear(); this.controller.abort(); }
}

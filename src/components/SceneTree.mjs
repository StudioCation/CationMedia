export class SceneTree {
  constructor(host, viewer) {
    this.host = host; this.viewer = viewer; this.query = ''; this.rows = new Map();
    host.addEventListener('contextmenu', event => { if (!event.target.closest('.tree-row')) { event.preventDefault(); this.onContext?.(null); } });
  }
  materials(object) { return [this.viewer.display.original.get(object) ?? object.material].flat().filter(Boolean).map(material => material.name || material.type); }
  select(object, reveal = false) {
    this.selected = object;
    if (reveal && this.query && !this.rows.has(object)) { this.query = ''; document.getElementById('search').value = ''; this.render(); }
    for (const [node, row] of this.rows) { row.classList.toggle('selected', node === object); row.setAttribute('aria-selected', String(node === object)); }
    if (reveal) this.rows.get(object)?.scrollIntoView({ block: 'nearest' });
  }
  render(root = this.root) {
    if (root !== this.root) this.selected = null;
    this.root = root; this.host.replaceChildren(); this.rows.clear(); if (!root) return;
    const add = (object, depth) => {
      const name = object.name || object.type, materials = this.materials(object);
      if (!this.query || `${name} ${materials.join(' ')}`.toLowerCase().includes(this.query)) {
        const row = document.createElement('div'); row.className = 'tree-row'; row.style.paddingLeft = `${12 + Math.min(depth, 10) * 16}px`;
        if (this.selected === object) row.classList.add('selected');
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(this.selected === object));
        const button = document.createElement('button'); button.className = 'tree-name'; button.title = `${object.type} · Select as texture target; double-click to frame`;
        const label = document.createElement('span'); label.textContent = name; button.append(label);
        if (materials.length) { const detail = document.createElement('small'); detail.className = 'material-names'; detail.textContent = materials.join(', '); detail.title = `Materials: ${materials.join(', ')}`; button.append(detail); }
        button.onclick = () => this.onSelect?.(this.selected === object ? null : object); button.ondblclick = () => this.viewer.fit(object);
        row.oncontextmenu = event => { event.preventDefault(); if (object.isMesh) this.onContext?.(object); };
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = object.visible; toggle.setAttribute('aria-label', `Show ${name}`); toggle.title = `Show ${name}`; toggle.onchange = () => { object.visible = toggle.checked; this.viewer.invalidate(); };
        row.append(button, toggle); this.host.append(row); this.rows.set(object, row);
      }
      for (const child of object.children) add(child, depth + 1);
    }; add(root, 0);
  }
  filter(query) { this.query = query.toLowerCase().trim(); this.render(); }
}

import { FrontSide, BackSide, DoubleSide, SRGBColorSpace, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping } from 'three';
import { textureSlots, textureCanvas } from '../managers/TextureExport.mjs';
import { inspectorField } from './Controls.mjs';

export class MaterialPanel {
  constructor(host, viewer, onChange) {
    this.host = host; this.viewer = viewer; this.onChange = onChange; this.index = 0; this.slot = 'map'; this.generation = 0;
    this.edited = new WeakSet(); this.editedTextures = new WeakSet();
  }
  materials() { return this.object ? [this.viewer.display.original.get(this.object) ?? this.object.material].flat() : []; }
  select(object) { if (this.object !== object) { this.index = 0; this.slot = 'map'; } this.object = object?.isMesh ? object : null; this.render(); }
  editable(textureSlot) {
    let material = this.materials()[this.index];
    if (!this.edited.has(material)) {
      const original = material; material = original.clone(); this.edited.add(material);
      const materials = this.materials(); materials[this.index] = material;
      this.viewer.display.original.set(this.object, Array.isArray(this.object.material) || materials.length > 1 ? materials : material);
      this.viewer.display.set(this.viewer.display.mode);
      let shared = false;
      for (const value of this.viewer.display.original.values()) if ([value].flat().includes(original)) shared = true;
      if (!shared) original.dispose();
    }
    if (textureSlot && material[textureSlot] && !this.editedTextures.has(material[textureSlot])) {
      const original = material[textureSlot], texture = original.clone(); material[textureSlot] = texture; this.editedTextures.add(texture);
      let shared = false;
      for (const value of this.viewer.display.original.values()) for (const mat of [value].flat()) if (Object.values(mat).includes(original)) shared = true;
      if (!shared) original.dispose();
    }
    return material;
  }
  changed(material) { material.needsUpdate = true; this.viewer.invalidate(); this.onChange?.(); }
  field(parent, label, input) {
    return inspectorField(parent, label, input);
  }
  selectField(parent, label, value, options, change) {
    const input = document.createElement('select');
    for (const [key, name] of options) input.add(new Option(name, key));
    input.value = String(value); input.onchange = () => change(input.value); this.field(parent, label, input); return input;
  }
  number(parent, label, value, change, { min, max, step = 0.01 } = {}) {
    const input = document.createElement('input'); input.type = 'number'; input.value = Number(value.toFixed(4)); input.step = step;
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max;
    input.onchange = () => {
      const next = input.valueAsNumber;
      if (!Number.isFinite(next)) { input.value = value; return; }
      const bounded = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)); input.value = bounded; change(bounded);
    };
    return this.field(parent, label, input);
  }
  check(parent, label, value, change) { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = value; input.onchange = () => change(input.checked); return this.field(parent, label, input); }
  render() {
    const ticket = ++this.generation; this.host.replaceChildren(); this.host.hidden = !this.object;
    if (!this.object) return;
    const materials = this.materials(); this.index = Math.min(this.index, materials.length - 1);
    const material = materials[this.index]; if (!material) return;
    const title = document.createElement('h2'); title.textContent = 'Material'; this.host.append(title);
    this.selectField(this.host, 'Material slot', this.index, materials.map((item, index) => [index, item.name || `Material ${index + 1}`]), value => { this.index = Number(value); this.render(); });
    const type = document.createElement('p'); type.className = 'inspector-note'; type.textContent = `${material.type.replace('Mesh', '').replace('Material', '')} · Edits apply to this mesh`; this.host.append(type);
    const update = (key, value) => { const target = this.editable(); target[key] = value; this.changed(target); };
    for (const [key, label] of [['color', 'Color'], ['emissive', 'Emission color']]) if (material[key]?.isColor) {
      const input = document.createElement('input'); input.type = 'color'; input.value = `#${material[key].getHexString()}`;
      input.oninput = () => { const target = this.editable(); target[key].set(input.value); this.changed(target); };
      this.field(this.host, label, input);
    }
    for (const [key, label, min, max] of [['opacity', 'Opacity', 0, 1], ['metalness', 'Metallic', 0, 1], ['roughness', 'Roughness', 0, 1], ['alphaTest', 'Alpha cutoff', 0, 1], ['emissiveIntensity', 'Emission strength', 0, 100]]) {
      if (typeof material[key] === 'number') this.number(this.host, label, material[key], value => update(key, value), { min, max });
    }
    this.check(this.host, 'Transparent', material.transparent, value => update('transparent', value));
    this.check(this.host, 'Depth write', material.depthWrite, value => update('depthWrite', value));
    this.selectField(this.host, 'Side', material.side, [[FrontSide, 'Front'], [BackSide, 'Back'], [DoubleSide, 'Double']], value => update('side', Number(value)));
    const textureTitle = document.createElement('h3'); textureTitle.textContent = 'Textures'; this.host.append(textureTitle);
    const slots = Object.keys(material).filter(key => material[key]?.isTexture);
    for (const slot of Object.keys(material.userData.viewerTextureRefs || {})) if (!slots.includes(slot)) slots.push(slot);
    if (!slots.length) { const note = document.createElement('p'); note.className = 'inspector-note'; note.textContent = 'No textures'; this.host.append(note); return; }
    if (!slots.includes(this.slot)) this.slot = slots[0];
    this.selectField(this.host, 'Texture slot', this.slot, slots.map(slot => [slot, textureSlots[slot] || slot]), value => { this.slot = value; this.render(); });
    const texture = material[this.slot], name = document.createElement('p'); name.className = 'texture-name';
    name.textContent = texture?.name || material.userData.viewerTextureRefs?.[this.slot] || this.slot; this.host.append(name);
    if (!texture?.image) { const note = document.createElement('p'); note.className = 'inspector-note'; note.textContent = 'Texture not found'; this.host.append(note); return; }
    const preview = document.createElement('div'); preview.className = 'texture-preview'; this.host.append(preview);
    textureCanvas(texture, 256).then(canvas => { if (ticket !== this.generation) return; canvas.setAttribute('aria-label', 'Texture preview'); preview.append(canvas); }).catch(() => { if (ticket === this.generation) preview.textContent = 'Preview unavailable'; });
    const size = document.createElement('p'); size.className = 'inspector-note'; size.textContent = `${texture.image.width} × ${texture.image.height}`; this.host.append(size);
    const editTexture = change => { const target = this.editable(this.slot); change(target[this.slot]); target[this.slot].needsUpdate = true; this.changed(target); };
    this.selectField(this.host, 'Color space', texture.colorSpace, [[SRGBColorSpace, 'sRGB'], [NoColorSpace, 'Linear / data']], value => editTexture(map => { map.colorSpace = value; }));
    const wrapOptions = [[RepeatWrapping, 'Repeat'], [ClampToEdgeWrapping, 'Clamp'], [MirroredRepeatWrapping, 'Mirror']];
    for (const [key, label] of [['wrapS', 'Wrap U'], ['wrapT', 'Wrap V']]) this.selectField(this.host, label, texture[key], wrapOptions, value => editTexture(map => { map[key] = Number(value); }));
    for (const [key, label] of [['repeat', 'Repeat'], ['offset', 'Offset'], ['center', 'Center']]) for (const [axis, axisLabel] of [['x', 'U'], ['y', 'V']]) this.number(this.host, `${label} ${axisLabel}`, texture[key][axis], value => editTexture(map => { map[key][axis] = value; }));
    this.number(this.host, 'Rotation °', texture.rotation * 180 / Math.PI, value => editTexture(map => { map.rotation = value * Math.PI / 180; }), { step: 1 });
    this.check(this.host, 'Flip Y', texture.flipY, value => editTexture(map => { map.flipY = value; }));
    const note = document.createElement('p'); note.className = 'inspector-note'; note.textContent = 'Right-click the mesh to convert textures.'; this.host.append(note);
  }
}

import { Vector3 } from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export class ShadingManager {
  constructor(display) { this.edits = new Map(); this.display = display; }
  materials(mesh) { return [this.display?.original.get(mesh) ?? mesh.material].flat(); }
  materialFlags(mesh, flags) {
    const before = this.materials(mesh);
    if (before.every((material, index) => Boolean(material.flatShading) === Boolean(flags[index]))) return;
    const after = before.map((material, index) => { const result = material.clone(); result.flatShading = Boolean(flags[index]); result.needsUpdate = true; return result; });
    const original = this.display?.original.get(mesh) ?? mesh.material;
    const replacement = Array.isArray(original) ? after : after[0];
    if (this.display) { this.display.original.set(mesh, replacement); this.display.set(this.display.mode); }
    else mesh.material = replacement;
    const retained = new Set(this.display ? [...this.display.original.values()].flat() : []);
    if (this.display) for (const material of before) if (!retained.has(material)) material.dispose();
  }
  mode(mesh) { return this.edits.get(mesh)?.mode || 'original'; }
  scopeMode(root) {
    const modes = new Set();
    root?.traverse(object => { if (object.isMesh) modes.add(this.mode(object)); });
    return modes.size > 1 ? 'mixed' : modes.values().next().value || 'original';
  }
  apply(root, mode) { root?.traverse(object => { if (object.isMesh) this.set(object, mode); }); }
  set(mesh, mode) {
    if (!mesh?.isMesh || !['smooth', 'auto', 'flat', 'original'].includes(mode)) return;
    const previous = this.edits.get(mesh), original = previous?.original || mesh.geometry;
    const flat = previous?.flat || this.materials(mesh).map(material => Boolean(material.flatShading));
    if (mode === 'original') {
      mesh.geometry = original; this.materialFlags(mesh, flat); previous?.geometry.dispose(); this.edits.delete(mesh); return;
    }
    // Independent corner normals preserve UV seams, skin weights and material groups.
    const geometry = original.index ? original.toNonIndexed() : original.clone();
    try {
      if (mode === 'flat') geometry.computeVertexNormals();
      else {
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new Vector3()).length() || 1;
        const center = geometry.boundingBox.getCenter(new Vector3());
        const position = geometry.attributes.position, normalized = position.clone();
        const factor = 1000 / size;
        for (let i = 0; i < normalized.count; i++) normalized.setXYZ(i, (position.getX(i) - center.x) * factor, (position.getY(i) - center.y) * factor, (position.getZ(i) - center.z) * factor);
        geometry.setAttribute('position', normalized);
        toCreasedNormals(geometry, mode === 'auto' ? Math.PI / 6 : Math.PI);
        geometry.setAttribute('position', position);
      }
      // Imported tangents no longer describe the edited normal basis.
      geometry.deleteAttribute('tangent');
      this.materialFlags(mesh, flat.map(() => false));
      mesh.geometry = geometry;
      this.edits.set(mesh, { original, geometry, mode, flat }); previous?.geometry.dispose();
    } catch (error) { geometry.dispose(); throw error; }
  }
  restore() {
    for (const [mesh, edit] of this.edits) { mesh.geometry = edit.original; this.materialFlags(mesh, edit.flat); edit.geometry.dispose(); }
    this.edits.clear();
  }
}

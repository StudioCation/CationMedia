import { BoxHelper, Raycaster, Vector2 } from 'three';
export function meshStats(root) {
  let meshes = 0, vertices = 0, triangles = 0;
  root?.traverse(object => {
    if (!object.isMesh) return;
    const instances = object.isInstancedMesh ? object.count : 1;
    const count = object.geometry.attributes.position?.count ?? 0;
    meshes += instances; vertices += count * instances;
    triangles += Math.floor((object.geometry.index?.count ?? count) / 3) * instances;
  });
  return { meshes, vertices, triangles };
}
export class SelectionManager {
  constructor(viewer, onSelect) {
    this.viewer = viewer; this.onSelect = onSelect; this.ray = new Raycaster();
    this.helper = new BoxHelper(undefined, 0x79dfb6); this.helper.visible = false;
    this.helper.material.depthTest = false; this.helper.renderOrder = 10;
    viewer.scene.add(this.helper);
    const canvas = viewer.renderer.domElement;
    this.down = event => { if (event.button === 0 || event.button === 2) this.start = { x: event.clientX, y: event.clientY, button: event.button }; };
    this.up = event => {
      const start = this.start; this.start = null;
      if (this.suppressClick) { this.suppressClick = false; return; }
      if (!start || event.button !== start.button || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
      const rect = canvas.getBoundingClientRect();
      this.ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), viewer.camera);
      viewer.root?.updateWorldMatrix(true, true);
      const hits = viewer.root ? this.ray.intersectObject(viewer.root, true) : [];
      const hit = hits.find(({ object }) => {
        if (!object.isMesh) return false;
        for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
        return true;
      });
      this.select(hit?.object ?? null);
      if (event.button === 2) this.onContext?.(hit?.object ?? null);
    };
    this.context = event => event.preventDefault();
    this.cancel = () => { this.start = null; };
    canvas.addEventListener('pointerdown', this.down); canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('contextmenu', this.context); canvas.addEventListener('pointercancel', this.cancel);
  }
  select(object) { this.selected = object; this.helper.visible = Boolean(object); if (object) this.helper.setFromObject(object); this.onSelect(object); this.viewer.invalidate(); }
  update() {
    if (!this.selected) return;
    this.helper.visible = true;
    for (let object = this.selected; object; object = object.parent) if (!object.visible) this.helper.visible = false;
    if (this.helper.visible) this.helper.update();
  }
  dispose() { const canvas = this.viewer.renderer.domElement; canvas.removeEventListener('pointerdown', this.down); canvas.removeEventListener('pointerup', this.up); canvas.removeEventListener('contextmenu', this.context); canvas.removeEventListener('pointercancel', this.cancel); this.viewer.scene.remove(this.helper); this.helper.geometry.dispose(); this.helper.material.dispose(); }
}

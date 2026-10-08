import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class TransformManager {
  constructor(viewer) {
    this.viewer = viewer; this.mode = 'translate';
    this.controls = new TransformControls(viewer.camera, viewer.renderer.domElement);
    this.controls.setSize(0.8); this.helper = this.controls.getHelper(); viewer.scene.add(this.helper);
    this.controls.addEventListener('dragging-changed', event => { viewer.controls.enabled = !event.value; });
    this.controls.addEventListener('mouseDown', () => { this.wasPlaying = viewer.animation.playing; viewer.animation.playing = false; this.onDragStart?.(); });
    this.controls.addEventListener('mouseUp', () => { viewer.animation.playing = this.wasPlaying; });
    this.controls.addEventListener('objectChange', () => { this.controls.object?.updateMatrixWorld(true); this.onChange?.(); viewer.invalidate(); });
    this.controls.addEventListener('change', () => viewer.invalidate());
  }
  select(object) { this.selected = object; this.sync(); }
  setMode(mode) {
    if (!['select', 'translate', 'rotate', 'scale'].includes(mode)) return;
    this.mode = mode; this.sync();
  }
  sync() {
    this.controls.camera = this.viewer.camera;
    if (this.selected && this.mode !== 'select') { this.controls.setMode(this.mode); this.controls.attach(this.selected); }
    else this.controls.detach();
    this.viewer.invalidate();
  }
  update() {
    this.controls.camera = this.viewer.camera;
    let visible = Boolean(this.selected);
    for (let node = this.selected; node; node = node.parent) if (!node.visible) visible = false;
    this.helper.visible = visible && this.mode !== 'select';
    this.controls.enabled = this.helper.visible;
  }
  dispose() { this.controls.detach(); this.viewer.scene.remove(this.helper); this.controls.dispose(); }
}

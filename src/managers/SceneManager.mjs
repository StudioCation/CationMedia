import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DisplayManager } from './DisplayManager.mjs';
import { AnimationManager } from './AnimationManager.mjs';
import { meshStats } from './SelectionManager.mjs';

export function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  root.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.skeleton) skeletons.add(object.skeleton); for (const material of [object.material].flat().filter(Boolean)) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); } });
  for (const item of [...geometries, ...materials, ...textures, ...skeletons]) item.dispose();
}
export class SceneManager {
  constructor(host, onTick) {
    this.host = host; this.onTick = onTick; this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#18181c');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = false; this.controls.addEventListener('change', () => this.invalidate());
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment(); this.environment = pmrem.fromScene(room); this.scene.environment = this.environment.texture; room.dispose(); pmrem.dispose();
    this.scene.environmentIntensity = 0.65;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x434b54, 0.6)); const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 6, 5); this.scene.add(key);
    this.grid = new THREE.GridHelper(12, 24, 0x56636a, 0x353d43); this.scene.add(this.grid);
    this.display = new DisplayManager(); this.animation = new AnimationManager();
    this.bonesVisible = false; this.skeletonHelper = null;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.dirty = true; this.last = performance.now(); this.loop = this.loop.bind(this); this.frame = requestAnimationFrame(this.loop);
  }
  invalidate() { this.dirty = true; }
  setActive(active) {
    if (this.active === active) return;
    this.active = active; cancelAnimationFrame(this.frame);
    if (active) { this.last = performance.now(); this.invalidate(); this.frame = requestAnimationFrame(this.loop); }
  }
  resize() { const { width, height } = this.host.getBoundingClientRect(); if (!width || !height) return; this.renderer.setSize(width, height); this.aspect = width / height; this.updateProjection(); this.invalidate(); }
  updateProjection() {
    if (this.camera.isPerspectiveCamera) this.camera.aspect = this.aspect || 1;
    else { const half = this.orthoHeight / 2; Object.assign(this.camera, { left: -half * (this.aspect || 1), right: half * (this.aspect || 1), top: half, bottom: -half }); }
    this.camera.updateProjectionMatrix();
  }
  toggleProjection() {
    const previous = this.camera, distance = previous.position.distanceTo(this.controls.target), fov = 40 * Math.PI / 180;
    if (previous.isPerspectiveCamera) {
      this.orthoHeight = 2 * distance * Math.tan(fov / 2);
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, previous.near, previous.far);
      this.camera.position.copy(previous.position);
    } else {
      const nextDistance = this.orthoHeight / previous.zoom / (2 * Math.tan(fov / 2));
      this.camera = new THREE.PerspectiveCamera(40, this.aspect || 1, previous.near, previous.far);
      this.camera.position.copy(previous.position).sub(this.controls.target).setLength(nextDistance).add(this.controls.target);
    }
    this.camera.quaternion.copy(previous.quaternion); this.camera.up.copy(previous.up);
    this.controls.object = this.camera; this.updateProjection(); this.controls.update(); this.invalidate();
  }
  orbit(angle) {
    const offset = this.camera.position.clone().sub(this.controls.target), spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += angle; this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical)); this.controls.update(); this.invalidate();
  }
  viewKey(key) {
    if (key === '4' || key === '6') this.orbit((key === '4' ? 1 : -1) * Math.PI / 12);
    if (key === '5') this.toggleProjection();
    if (['1', '3', '7'].includes(key)) { if (this.camera.isPerspectiveCamera) this.toggleProjection(); this.view({ 1: 'front', 3: 'right', 7: 'top' }[key]); }
    return this.camera.isOrthographicCamera ? 'Orthographic' : 'Perspective';
  }
  loop(now) { this.frame = requestAnimationFrame(this.loop); const delta = Math.min((now - this.last) / 1000, 0.1); this.last = now; if (document.hidden) return; if (this.animation.playing) { this.animation.update(delta); this.dirty = true; } if (this.controls.autoRotate) { this.controls.update(delta); this.dirty = true; } if (this.dirty) { this.beforeRender?.(); this.renderer.render(this.scene, this.camera); this.onTick?.(); this.dirty = false; } }
  clearSkeletonHelper() {
    if (!this.skeletonHelper) return;
    this.scene.remove(this.skeletonHelper);
    this.skeletonHelper.geometry.dispose(); this.skeletonHelper.material.dispose(); this.skeletonHelper = null;
  }
  setBonesVisible(visible) {
    this.bonesVisible = Boolean(visible);
    if (this.skeletonHelper) this.skeletonHelper.visible = this.bonesVisible;
    this.invalidate();
  }
  load(root, clips) {
    this.animation.dispose(); this.display.restore(); this.clearSkeletonHelper();
    if (this.root) { this.scene.remove(this.root); disposeObject(this.root); }
    this.root = root; this.scene.add(root); this.display.attach(root);
    if (this.display.bones().length) {
      this.skeletonHelper = new THREE.SkeletonHelper(root);
      this.skeletonHelper.visible = this.bonesVisible;
      this.skeletonHelper.material.depthTest = false;
      this.skeletonHelper.renderOrder = 1000;
      this.scene.add(this.skeletonHelper);
    }
    this.animation.load(root, clips); this.fit();
  }
  frameSelected(object) {
    if (!object) return;
    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() === 0) this.camera.getWorldDirection(direction).negate();
    this.fit(object, direction);
  }
  fit(object = this.root, direction = new THREE.Vector3(0.3, 0.2, 1)) {
    if (!object) return;
    object.updateWorldMatrix(true, true); const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) { box.min.set(-1, -1, -1); box.max.set(1, 1, 1); }
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01), fov = 40 * Math.PI / 180;
    const distance = radius / Math.sin(Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * (this.aspect || 1))));
    this.orthoHeight = 2 * distance * Math.tan(fov / 2); this.camera.zoom = 1; this.updateProjection();
    this.camera.near = Math.max(radius / 1000, 0.0001); this.camera.far = Math.max(distance * 100, 100); this.camera.updateProjectionMatrix();
    this.controls.target.copy(center); this.camera.up.set(0, 1, 0); this.camera.position.copy(center).add(direction.clone().normalize().multiplyScalar(distance)); this.controls.maxDistance = distance * 20; this.controls.minDistance = radius * 0.01; this.controls.update();
    if (object === this.root) { this.grid.position.set(center.x, box.min.y - radius * 0.003, center.z); this.grid.scale.setScalar(radius / 2); }
    this.invalidate();
  }
  view(name) { this.fit(this.root, { front: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), top: new THREE.Vector3(0, 1, 0.001) }[name]); }
  stats(object = this.root) { return meshStats(object); }
  dispose() { cancelAnimationFrame(this.frame); this.observer.disconnect(); this.animation.dispose(); this.display.restore(); this.clearSkeletonHelper(); if (this.root) disposeObject(this.root); this.display.dispose(); this.controls.dispose(); this.grid.geometry.dispose(); this.grid.material.dispose(); this.environment.dispose(); this.renderer.dispose(); }
}

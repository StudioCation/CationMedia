import { AnimationMixer } from 'three';
export class AnimationManager {
  load(root, clips = []) { this.dispose(); this.root = root; this.clips = clips; this.mixer = new AnimationMixer(root); this.select(0); }
  select(index) { this.mixer?.stopAllAction(); this.clip = this.clips?.[index]; this.action = this.clip ? this.mixer.clipAction(this.clip).reset().play() : null; this.playing = false; }
  seek(time) { if (this.action) { this.action.time = Math.max(0, Math.min(time, this.clip.duration)); this.mixer.update(0); } }
  update(delta) { if (this.playing && this.action) this.mixer.update(delta * (this.speed ?? 1)); }
  dispose() { if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); } this.mixer = null; this.action = null; this.playing = false; }
}

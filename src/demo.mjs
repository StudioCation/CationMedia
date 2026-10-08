import { Group, Mesh, TorusGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial, AnimationClip, NumberKeyframeTrack } from 'three';
export function createDemo() {
  const root = new Group(); root.name = 'Demo scene';
  const base = new Mesh(new CylinderGeometry(1.25, 1.3, 0.35, 64), new MeshStandardMaterial({ color: '#373e43', roughness: 0.65 })); base.name = 'Base'; base.position.y = 0.175;
  const ring = new Mesh(new TorusGeometry(1.3, 0.24, 24, 80), new MeshStandardMaterial({ color: '#79dfb6', roughness: 0.28, metalness: 0.15 })); ring.name = 'Ring'; ring.position.y = 1.9;
  const core = new Mesh(new IcosahedronGeometry(0.65, 0), new MeshStandardMaterial({ color: '#a9b3c1', roughness: 0.45, metalness: 0.25, flatShading: true })); core.name = 'Core'; core.position.y = 1.9;
  root.add(base, ring, core);
  const clips = [new AnimationClip('Rotation', 5, [new NumberKeyframeTrack(`${core.uuid}.rotation[y]`, [0, 5], [0, Math.PI * 2])])];
  return { root, clips };
}

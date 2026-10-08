import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, MeshNormalMaterial } from 'three';
export class DisplayManager {
  constructor() {
    this.original = new Map(); this.mode = 'materials'; this.weightBone = null; this.weightMaterials = new Map();
    this.solid = new MeshStandardMaterial({ color: '#aab5c0', roughness: 0.7 });
    this.wire = new MeshStandardMaterial({ color: '#79dfb6', wireframe: true });
    this.normals = new MeshNormalMaterial();
    this.vertex = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false });
    this.uncolored = new MeshBasicMaterial({ color: '#626a70', side: DoubleSide, toneMapped: false });
  }
  attach(root) {
    this.restore();
    root.traverse(object => { if (object.isMesh) this.original.set(object, object.material); });
    const bones = this.bones(); this.weightBone = bones[0]?.id ?? null;
    if (!this.set(this.mode)) this.set('materials');
  }
  bones() {
    const result = [], seen = new Set();
    for (const object of this.original.keys()) for (const [index, bone] of (object.skeleton?.bones || []).entries()) {
      if (seen.has(bone.uuid)) continue;
      seen.add(bone.uuid); result.push({ id: bone.uuid, name: bone.name || `Bone ${index + 1}` });
    }
    return result;
  }
  setWeightBone(id) {
    if (!this.bones().some(bone => bone.id === id)) return false;
    this.weightBone = id;
    for (const [object, material] of this.weightMaterials) {
      const index = object.skeleton?.bones.findIndex(bone => bone.uuid === id) ?? -1;
      if (material.userData.weightShader) material.userData.weightShader.uniforms.selectedBone.value = index;
      material.userData.selectedBone = index;
    }
    return true;
  }
  weightMaterial(object) {
    if (this.weightMaterials.has(object)) return this.weightMaterials.get(object);
    const material = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
    material.userData.selectedBone = object.skeleton.bones.findIndex(bone => bone.uuid === this.weightBone);
    material.onBeforeCompile = shader => {
      shader.uniforms.selectedBone = { value: material.userData.selectedBone };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWeight;\nuniform int selectedBone;')
        .replace('#include <color_vertex>', `#include <color_vertex>
          vWeight = 0.0;
          if (int(skinIndex.x) == selectedBone) vWeight += skinWeight.x;
          if (int(skinIndex.y) == selectedBone) vWeight += skinWeight.y;
          if (int(skinIndex.z) == selectedBone) vWeight += skinWeight.z;
          if (int(skinIndex.w) == selectedBone) vWeight += skinWeight.w;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWeight;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float w = clamp(vWeight, 0.0, 1.0);
          diffuseColor.rgb = mix(vec3(0.08, 0.18, 0.8), vec3(1.0, 0.15, 0.04), w);`);
      material.userData.weightShader = shader;
    };
    this.weightMaterials.set(object, material);
    return material;
  }
  supports(mode) {
    if (!['materials', 'wire', 'solid', 'normals', 'vertex', 'weights'].includes(mode)) return false;
    if (mode === 'weights' && ![...this.original.keys()].some(object => object.isSkinnedMesh && object.skeleton?.bones.length && object.geometry?.getAttribute('skinIndex') && object.geometry?.getAttribute('skinWeight'))) return false;
    return true;
  }
  set(mode) {
    if (!this.supports(mode)) return false;
    this.mode = mode;
    for (const [object, material] of this.original) object.material = mode === 'materials' ? material
      : mode === 'vertex' ? (object.geometry?.getAttribute('color') ? this.vertex : this.uncolored)
      : mode === 'weights' ? (object.isSkinnedMesh && object.geometry?.getAttribute('skinWeight') && object.geometry?.getAttribute('skinIndex') ? this.weightMaterial(object) : this.uncolored)
      : this[mode];
    return true;
  }
  restore() {
    for (const [object, material] of this.original) object.material = material;
    this.original.clear();
    for (const material of this.weightMaterials.values()) material.dispose();
    this.weightMaterials.clear();
  }
  dispose() { this.restore(); for (const key of ['solid', 'wire', 'normals', 'vertex', 'uncolored']) this[key].dispose(); }
}

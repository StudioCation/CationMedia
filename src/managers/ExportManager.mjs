import { Group, Mesh, Matrix4, Vector3, MeshStandardMaterial } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { TextureManager } from './TextureManager.mjs';
import { basename, isTexture } from './textureMatching.mjs';

const sourceName = value => {
  try { value = decodeURIComponent(value); } catch {}
  return String(value).replace(/\\/g, '/').split('/').pop().split(/[?#]/)[0];
};

// Export snapshots never change display mode, shared materials, or playback state.
export function exportSnapshot(source, display, staticPose = false) {
  source.updateWorldMatrix(true, true);
  const geometries = new Set(), materials = new Set();
  const materialCopy = object => {
    const copy = material => {
      let result;
      if (material.isMeshStandardMaterial || material.isMeshBasicMaterial) result = material.clone();
      else {
        result = new MeshStandardMaterial({ roughness: 0.7 });
        for (const key of ['name', 'color', 'map', 'normalMap', 'normalScale', 'aoMap', 'aoMapIntensity', 'emissive', 'emissiveMap', 'emissiveIntensity', 'alphaMap', 'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors']) {
          if (material[key] !== undefined) result[key] = material[key]?.clone && !material[key]?.isTexture ? material[key].clone() : material[key];
        }
      }
      materials.add(result); return result;
    };
    const original = display.original.get(object) ?? object.material;
    return Array.isArray(original) ? original.map(copy) : copy(original);
  };
  let root;
  if (staticPose) {
    root = new Group(); root.name = source.name;
    const position = new Vector3(), instance = new Matrix4();
    source.traverse(object => {
      if (!object.isMesh) return;
      object.skeleton?.update();
      const geometry = object.geometry.clone(); geometries.add(geometry);
      if (object.isSkinnedMesh || object.morphTargetInfluences?.length) {
        for (let i = 0; i < geometry.attributes.position.count; i++) { object.getVertexPosition(i, position); geometry.attributes.position.setXYZ(i, position.x, position.y, position.z); }
        geometry.morphAttributes = {}; geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight'); geometry.computeVertexNormals();
      }
      const material = materialCopy(object);
      for (let i = 0; i < (object.isInstancedMesh ? object.count : 1); i++) {
        const mesh = new Mesh(geometry, material); mesh.name = object.name;
        mesh.matrix.copy(object.matrixWorld);
        if (object.isInstancedMesh) { object.getMatrixAt(i, instance); mesh.matrix.multiply(instance); }
        mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale); root.add(mesh);
      }
    });
  } else {
    root = clone(source);
    const sources = [], targets = []; source.traverse(object => sources.push(object)); root.traverse(object => targets.push(object));
    for (let i = 0; i < sources.length; i++) {
      targets[i].uuid = sources[i].uuid;
      targets[i].userData = {};
      if (sources[i].material) targets[i].material = materialCopy(sources[i]);
    }
  }
  root.updateMatrixWorld(true);
  return { root, dispose() { for (const item of [...geometries, ...materials]) item.dispose(); } };
}

export class ExportManager {
  constructor(viewer) { this.viewer = viewer; }
  setSource(descriptor, parser) { this.source = descriptor; this.parser = parser; }
  meshes() {
    const result = [];
    this.viewer.root?.traverse(object => { if (object.isMesh) result.push(object); });
    return result;
  }
  sourceTextureCount() {
    const images = this.parser?.json?.images || [];
    const assets = (this.source?.assets || []).filter(asset => isTexture(asset.name));
    const referenced = new Set(images.flatMap(image => [image.name, image.uri].filter(value => value && !value.startsWith('data:')).map(basename)));
    return images.length + assets.filter(asset => !referenced.has(basename(asset.name))).length;
  }
  async sourceTextures() {
    const images = this.parser?.json?.images;
    const assets = (this.source?.assets || []).filter(asset => isTexture(asset.name));
    if (!this.sourceTextureCount()) return [];
    const readAsset = async asset => new Uint8Array(await (asset.file ? asset.file.arrayBuffer() : fetch(asset.url).then(response => {
        if (!response.ok) throw new Error(`Unable to read ${asset.name}`);
        return response.arrayBuffer();
      })));
    if (!images) return Promise.all(assets.map(async asset => ({ name: sourceName(asset.name), origin: 'source file', data: await readAsset(asset) })));
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/ktx2': 'ktx2' };
    const results = [], referenced = new Set();
    for (const [index, image] of images.entries()) {
      const uri = image.uri;
      const embedded = image.bufferView !== undefined || uri?.startsWith('data:');
      const candidates = [image.name, uri && !uri.startsWith('data:') ? uri : ''].filter(Boolean);
      const matches = !embedded ? assets.filter(asset => candidates.some(candidate => basename(asset.name) === basename(candidate))) : [];
      const asset = matches.length === 1 ? matches[0] : null;
      let data;
      if (asset) { data = await readAsset(asset); referenced.add(asset); }
      else if (image.bufferView !== undefined) data = await this.parser.getDependency('bufferView', image.bufferView);
      else if (uri?.startsWith('data:')) data = await fetch(uri).then(response => response.arrayBuffer());
      else if (uri) {
        const response = await fetch(new URL(uri, this.source.url).href);
        if (!response.ok) throw new Error(`Unable to read source texture ${uri}`);
        data = await response.arrayBuffer();
      } else throw new Error(`Image ${index + 1} has no source bytes.`);
      const filename = image.name || (uri && !uri.startsWith('data:') ? sourceName(uri) : `image_${index + 1}`);
      const mime = image.mimeType || uri?.match(/^data:([^;,]+)/)?.[1];
      const name = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.${extension[mime] || 'bin'}`;
      results.push({ name, origin: asset || !embedded ? 'source file' : 'embedded image', data: new Uint8Array(data) });
    }
    for (const asset of assets) if (!referenced.has(asset))
      results.push({ name: sourceName(asset.name), origin: 'source file', data: await readAsset(asset) });
    return results;
  }
  async model(format, selected) {
    const snapshot = exportSnapshot(selected || this.viewer.root, this.viewer.display, Boolean(selected) || !['glb', 'gltf', 'fbx'].includes(format));
    try {
      if (format === 'glb' || format === 'gltf' || format === 'fbx') {
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const textureUtils = await import('three/addons/utils/WebGLTextureUtils.js');
        const result = await new GLTFExporter().setTextureUtils(textureUtils).parseAsync(snapshot.root, { binary: format !== 'gltf', animations: selected ? [] : this.viewer.animation.clips, onlyVisible: false });
        return format === 'gltf' ? new TextEncoder().encode(JSON.stringify(result)) : new Uint8Array(result);
      }
      if (format === 'obj') { const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js'); return new TextEncoder().encode(new OBJExporter().parse(snapshot.root)); }
      if (format === 'stl') { const { STLExporter } = await import('three/addons/exporters/STLExporter.js'); const data = new STLExporter().parse(snapshot.root, { binary: true }); return new Uint8Array(data.buffer, data.byteOffset, data.byteLength); }
      if (format === 'ply') { const { PLYExporter } = await import('three/addons/exporters/PLYExporter.js'); return new Uint8Array(new PLYExporter().parse(snapshot.root, undefined, { binary: true, littleEndian: true })); }
      throw new Error('Unsupported export format.');
    } finally { snapshot.dispose(); this.viewer.invalidate(); }
  }
  async texture(asset, format) {
    const texture = await new TextureManager().decode(asset);
    try {
      const image = texture.image, canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (format === 'jpg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, `image/${format === 'jpg' ? 'jpeg' : format}`, 0.95));
      if (!blob) throw new Error('Unable to encode texture.');
      return new Uint8Array(await blob.arrayBuffer());
    } finally { texture.dispose(); }
  }
}

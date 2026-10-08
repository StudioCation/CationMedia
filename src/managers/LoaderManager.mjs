import { LoadingManager, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TextureManager, PSDLoader, readTIFF, clearMissingTextures } from './TextureManager.mjs';
import { matchResource, isTexture } from './textureMatching.mjs';
import { applySidecar, findSidecar } from './SidecarManager.mjs';

export class LoaderManager {
  constructor(renderer) { this.renderer = renderer; }
  async load(descriptor) {
    const missing = [];
    const manager = new LoadingManager();
    const assets = descriptor.assets || [];
    let complete;
    const settled = new Promise(resolve => { complete = resolve; });
    manager.onLoad = complete;
    manager.itemStart('__model__');
    manager.addHandler(/\.psd(?:[?#].*)?$/i, new PSDLoader(manager));
    manager.addHandler(/\.tiff?(?:[?#].*)?$/i, new PSDLoader(manager, readTIFF));
    manager.onError = url => missing.push(url);
    manager.setURLModifier(url => { url = matchResource(url, assets); const decoder = url.startsWith(new URL('decoders/', document.baseURI).href); if (!decoder && !/^(model:|blob:|data:|https?:\/\/127\.0\.0\.1[:/]|https?:\/\/localhost[:/])/.test(url) && !url.startsWith('/')) throw new Error('External model resources are blocked. Save textures alongside the model.'); return url; });
    const { url, extension } = descriptor;
    let root, parser, clips = [];
    if (['glb', 'gltf'].includes(extension)) {
      const base = new URL('decoders/', document.baseURI).href;
      const draco = new DRACOLoader(manager).setDecoderPath(`${base}draco/`);
      const ktx = new KTX2Loader(manager).setTranscoderPath(`${base}basis/`).detectSupport(this.renderer);
      try { const result = await new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder).loadAsync(url); root = result.scene; clips = result.animations; parser = result.parser; }
      finally { draco.dispose(); ktx.dispose(); }
    } else if (extension === 'fbx') {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js'); root = await new FBXLoader(manager).loadAsync(url); clips = root.animations;
    } else if (extension === 'obj') {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      const text = await fetch(manager.resolveURL(url)).then(response => { if (!response.ok) throw new Error('Unable to read OBJ'); return response.text(); });
      const loader = new OBJLoader(manager);
      const libraries = [...text.matchAll(/^mtllib\s+(.+)$/gm)].map(match => match[1].trim());
      if (libraries.length) {
        const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
        try { const materials = await new MTLLoader(manager).loadAsync(new URL(libraries[0], url).href); materials.preload(); loader.setMaterials(materials); } catch { missing.push(libraries[0]); }
      }
      root = loader.parse(text);
    } else if (['stl', 'ply'].includes(extension)) {
      const module = extension === 'stl' ? await import('three/addons/loaders/STLLoader.js') : await import('three/addons/loaders/PLYLoader.js');
      const Loader = module.STLLoader || module.PLYLoader;
      const geometry = await new Loader(manager).loadAsync(url);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      root = new Group(); root.add(new Mesh(geometry, new MeshStandardMaterial({ color: '#b9c4ce', vertexColors: Boolean(geometry.attributes.color), roughness: 0.65 })));
    } else if (extension === 'dae') {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js'); const result = await new ColladaLoader(manager).loadAsync(url); root = result.scene; clips = root.animations;
    } else if (extension === '3ds') {
      const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js'); root = await new TDSLoader(manager).loadAsync(url);
    } else throw new Error(`Format .${extension} is not supported`);
    manager.itemEnd('__model__');
    await settled;
    const flipY = !['glb', 'gltf'].includes(extension);
    root.userData.viewerTextureFlipY = flipY;
    if (parser) root.traverse(object => {
      for (const material of [object.material].flat().filter(Boolean)) {
        const index = parser.associations.get(material)?.materials, definition = parser.json.materials?.[index];
        if (!definition) continue;
        const maps = { map: definition.pbrMetallicRoughness?.baseColorTexture, normalMap: definition.normalTexture, aoMap: definition.occlusionTexture, emissiveMap: definition.emissiveTexture, roughnessMap: definition.pbrMetallicRoughness?.metallicRoughnessTexture, metalnessMap: definition.pbrMetallicRoughness?.metallicRoughnessTexture };
        for (const [slot, map] of Object.entries(maps)) {
          const source = parser.json.textures?.[map?.index]?.source, uri = parser.json.images?.[source]?.uri;
          if (uri && !uri.startsWith('data:')) { material.userData.viewerTextureRefs ||= {}; material.userData.viewerTextureRefs[slot] = uri; }
        }
      }
    });
    const sidecar = findSidecar(descriptor), sidecarWarnings = [];
    if (sidecar) {
      try {
        const data = sidecar.file ? JSON.parse(await sidecar.file.text()) : await fetch(sidecar.url).then(response => {
          if (!response.ok) throw new Error('Unable to read material JSON');
          return response.json();
        });
        const result = await applySidecar(root, data, assets, { parser });
        sidecarWarnings.push(...result.warnings);
      } catch (error) { sidecarWarnings.push(`${sidecar.name}: ${error.message}`); }
    }
    let textureWarning = '';
    try {
      const textures = new TextureManager();
      await textures.apply(root, assets.filter(asset => isTexture(asset.name)), { flipY });
      await textures.apply(root, assets.filter(asset => asset.file && isTexture(asset.name)), { flipY, explicit: true, preserveSidecar: true });
    }
    catch (error) { textureWarning = `Automatic textures: ${error.message}`; }
    clearMissingTextures(root);
    return { root, clips, parser, warnings: [missing.length ? `Missing resources: ${missing.length}. Drop the missing textures to apply them.` : '', ...sidecarWarnings, textureWarning].filter(Boolean).join(' ') };
  }
}

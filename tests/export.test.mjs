import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshLambertMaterial, Float32BufferAttribute, NumberKeyframeTrack, AnimationClip } from 'three';
import { DisplayManager } from '../src/managers/DisplayManager.mjs';
import { AnimationManager } from '../src/managers/AnimationManager.mjs';
import { ExportManager, exportSnapshot } from '../src/managers/ExportManager.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

test('static export bakes current morph and world transform while preserving viewport materials', () => {
  const root = new Group(); root.position.x = 5;
  const geometry = new BoxGeometry(), values = geometry.attributes.position.array.slice();
  for (let i = 0; i < values.length; i += 3) values[i] += 2;
  geometry.morphAttributes.position = [new Float32BufferAttribute(values, 3)];
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: 'red' })); root.add(mesh); mesh.morphTargetInfluences[0] = 0.5;
  const display = new DisplayManager(); display.attach(root); display.set('normals');
  const snapshot = exportSnapshot(mesh, display, true), exported = snapshot.root.children[0];
  assert.equal(exported.position.x, 5);
  assert.equal(exported.geometry.attributes.position.getX(0), geometry.attributes.position.getX(0) + 1);
  assert.equal(exported.material.color.getHex(), 0xff0000); assert.equal(mesh.material, display.normals);
  assert.equal(Object.keys(exported.geometry.morphAttributes).length, 0);
  snapshot.dispose(); display.dispose();
});

test('morph animation plays and survives whole-scene GLB export and import', async () => {
  const root = new Group(), geometry = new BoxGeometry(), values = geometry.attributes.position.array.slice();
  for (let i = 0; i < values.length; i += 3) values[i] += 1;
  const target = new Float32BufferAttribute(values, 3); target.name = 'Smile'; geometry.morphAttributes.position = [target];
  const mesh = new Mesh(geometry, new MeshLambertMaterial()); mesh.name = 'Face'; root.add(mesh);
  const clip = new AnimationClip('Smile', 1, [new NumberKeyframeTrack('Face.morphTargetInfluences[Smile]', [0, 1], [0, 1])]);
  const animation = new AnimationManager(); animation.load(root, [clip]); animation.seek(0.5);
  assert.equal(mesh.morphTargetInfluences[0], 0.5);
  const display = new DisplayManager(); display.attach(root); display.set('normals');
  const exporter = new ExportManager({ root, display, animation, invalidate() {} });
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
    async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onloadend?.(); }
  };
  try {
    const bytes = await exporter.model('glb');
    const loaded = await new GLTFLoader().parseAsync(bytes.buffer, '');
    let imported;
    loaded.scene.traverse(object => { if (object.isMesh) imported = object; });
    assert.equal(imported.geometry.morphAttributes.position.length, 1);
    assert.equal(loaded.animations.length, 1);
    const playback = new AnimationManager(); playback.load(loaded.scene, loaded.animations); playback.seek(0.75);
    assert.ok(Math.abs(imported.morphTargetInfluences[0] - 0.75) < 0.001);
    playback.dispose();
  } finally { globalThis.FileReader = previous; animation.dispose(); display.dispose(); }
});

test('original texture bytes and GLB embedded bytes remain separate', async () => {
  const root = new Group(), display = new DisplayManager(); display.attach(root);
  const exporter = new ExportManager({ root, display, animation: { clips: [] }, invalidate() {} });
  const original = Uint8Array.from([1, 2, 3, 4]), embedded = Uint8Array.from([8, 7, 6]);
  exporter.setSource({ assets: [{ name: 'Texture.png', file: new File([original], 'Texture.png') }] }, {
    json: { images: [{ name: 'Texture.png', mimeType: 'image/png', bufferView: 0 }] },
    getDependency: async () => embedded.buffer
  });
  const files = await exporter.sourceTextures();
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(file => file.origin), ['embedded image', 'source file']);
  assert.deepEqual([...files[0].data], [...embedded]); assert.deepEqual([...files[1].data], [...original]);
  display.dispose();
});

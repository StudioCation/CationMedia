import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, SkinnedMesh, Bone, Skeleton, BoxGeometry, MeshBasicMaterial, NumberKeyframeTrack, AnimationClip, Uint16BufferAttribute, Float32BufferAttribute } from 'three';
import { DisplayManager } from '../src/managers/DisplayManager.mjs';
import { AnimationManager } from '../src/managers/AnimationManager.mjs';
import { inside, supported, resolveAsset } from '../electron/files.mjs';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('display modes restore original multi-material meshes', () => { const root = new Group(), materials = [new MeshBasicMaterial(), new MeshBasicMaterial()]; const mesh = new Mesh(new BoxGeometry(), materials); root.add(mesh); const display = new DisplayManager(); display.attach(root); for (const mode of ['wire', 'solid', 'normals']) { display.set(mode); assert.equal(mesh.material, display[mode]); } display.set('materials'); assert.equal(mesh.material, materials); display.dispose(); assert.equal(mesh.material, materials); mesh.geometry.dispose(); materials.forEach(material => material.dispose()); });

test('vertex colors and selected bone weights use existing mesh attributes', () => {
  const root = new Group(), geometry = new BoxGeometry(), original = new MeshBasicMaterial();
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array.from({ length: count }, () => [0, 1, 0, 0]).flat(), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count }, () => [0.75, 0.25, 0, 0]).flat(), 4));
  const mesh = new SkinnedMesh(geometry, original), first = new Bone(), second = new Bone();
  first.name = 'Root'; second.name = 'Tip'; first.add(second); mesh.add(first); mesh.bind(new Skeleton([first, second])); root.add(mesh);
  const display = new DisplayManager(); display.attach(root);
  assert.equal(display.set('vertex'), true);
  assert.equal(mesh.material, display.uncolored);
  assert.equal(geometry.getAttribute('color'), undefined, 'Preview must not invent or save vertex colors');
  assert.equal(display.set('weights'), true);
  const weightMaterial = mesh.material, shader = { uniforms: {}, vertexShader: '#include <common>\n#include <color_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
  weightMaterial.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /skinWeight\.x/);
  assert.equal(shader.uniforms.selectedBone.value, 0);
  assert.equal(display.setWeightBone(second.uuid), true);
  assert.equal(shader.uniforms.selectedBone.value, 1);
  geometry.setAttribute('color', new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0]).flat(), 3));
  assert.equal(display.set('vertex'), true); assert.equal(mesh.material, display.vertex);
  display.set('materials'); assert.equal(mesh.material, original);
  display.dispose(); geometry.dispose(); original.dispose();
});
test('animation seek, pause, speed and clip switching', () => { const root = new Group(); const clips = [new AnimationClip('move', 2, [new NumberKeyframeTrack('.position[x]', [0, 2], [0, 10])])]; const manager = new AnimationManager(); manager.load(root, clips); manager.seek(1); assert.equal(root.position.x, 5); manager.update(0.2); assert.equal(root.position.x, 5); manager.playing = true; manager.speed = 2; manager.update(0.25); assert.equal(root.position.x, 7.5); manager.select(0); assert.equal(manager.playing, false); manager.load(new Group(), []); assert.equal(manager.action, null); manager.dispose(); });
test('supported file matching is case insensitive and rejects unrelated input', () => { assert.equal(supported('C:\\models\\A.GLB'), true); assert.equal(supported('thing.blend'), true); assert.equal(supported('--inspect'), false); assert.equal(supported(null), false); });
test('asset resolver rejects paths outside the granted directory', async () => { const base = await mkdtemp(path.join(os.tmpdir(), 'viewer-test-')); try { const root = await realpath(base); await writeFile(path.join(root, 'model.bin'), 'data'); assert.equal(await resolveAsset(root, 'model.bin'), path.join(root, 'model.bin')); assert.equal(inside(root, `${root}-other/file`), false); await assert.rejects(resolveAsset(root, '../missing')); } finally { await rm(base, { recursive: true, force: true }); } });

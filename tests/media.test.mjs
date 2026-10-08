import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { detectMediaType, hasCapability } from '../shared/mediaTypes.mjs';
import { discoverTextures } from '../electron/TextureDiscovery.mjs';
import { applySidecar } from '../src/managers/SidecarManager.mjs';
import { TextureManager } from '../src/managers/TextureManager.mjs';
import { meshTextures } from '../src/managers/TextureExport.mjs';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from 'three';

test('only registered media families enable the corresponding tools', () => {
  assert.equal(detectMediaType('WORLD.GLB')?.id, 'model3d');
  assert.equal(detectMediaType('image.png')?.id, 'image');
  assert.equal(detectMediaType('photo.JPEG')?.id, 'image');
  assert.equal(hasCapability('model3d', 'transform'), true);
  assert.equal(hasCapability('image', 'transform'), false);
  assert.equal(hasCapability(null, 'materials'), false);
});
test('texture discovery includes immediate sibling folders and parent files but never deeper levels', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-discovery-'));
  try {
    for (const dir of ['models/sub/deep', 'textures/deep']) await mkdir(path.join(folder, dir), { recursive: true });
    for (const file of ['models/local.png', 'models/sub/map.png', 'parent.png', 'textures/albedo.png', 'textures/deep/skip.png', 'models/sub/deep/skip.png']) await writeFile(path.join(folder, file), 'fixture');
    const result = await discoverTextures(path.join(folder, 'models/world.glb'), [path.join(folder, 'models/local.png')]);
    assert.deepEqual(result.files.map(file => file.relative.replaceAll('\\', '/')).sort(), ['models/sub/map.png', 'parent.png', 'textures/albedo.png']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('accepted discoveries repair only named missing maps and preserve material edits and loaded atlases', async () => {
  const root = new Group(), mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); mesh.name = 'body'; root.add(mesh);
  await applySidecar(root, { objects: { body: { materials: ['body'] } }, materials: { body: { params: { base_color_texture: 'atlas', normal_texture: 'normal' } } } }, [], {});
  mesh.material.roughness = 0.37;
  const manager = new TextureManager(); manager.decode = async asset => { const texture = new Texture({ width: 2, height: 2 }); texture.name = asset.name; return texture; };
  const result = await manager.apply(root, [{ name: 'atlas.png' }, { name: 'unrelated.png' }], { repair: true, flipY: false });
  assert.equal(result.applied, 1); assert.equal(mesh.material.roughness, 0.37); assert.equal(mesh.material.map.name, 'atlas.png'); assert.equal(mesh.material.normalMap, null);
  const map = mesh.material.map;
  await manager.apply(root, [{ name: 'atlas.png' }], { repair: true });
  assert.equal(mesh.material.map, map);
});
test('texture export collects unique images across material slots and child meshes', () => {
  const root = new Group(), texture = new Texture({ width: 1, height: 1 }); texture.name = 'atlas.png';
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture })), new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture.clone() })));
  assert.equal(meshTextures(root).length, 1);
  assert.equal(meshTextures(root)[0].name, 'atlas.png');
});

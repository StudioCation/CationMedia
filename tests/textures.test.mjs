import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from 'three';
import { TextureManager, clearMissingTextures } from '../src/managers/TextureManager.mjs';
import { textureInfo, matchResource, chooseTexture } from '../src/managers/textureMatching.mjs';
import { DisplayManager } from '../src/managers/DisplayManager.mjs';
import { meshStats } from '../src/managers/SelectionManager.mjs';
import { nearbyTextures } from '../electron/textureFiles.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('texture matching resolves foreign path basenames and map suffixes', () => {
  const assets = [{ name: 'Body_BaseColor.PNG', url: 'model://abc/Body_BaseColor.PNG' }, { name: 'Body_Normal.psd', url: 'model://abc/Body_Normal.psd' }];
  assert.equal(matchResource('C:\\old\\BODY_BASECOLOR.png', assets), assets[0].url);
  assert.deepEqual(textureInfo('Body_Normal.psd'), { slot: 'normalMap', stem: 'body' });
  assert.equal(chooseTexture(assets, 'Body', 'Cube', 'normalMap', false), assets[1]);
  assert.equal(chooseTexture([{ name: 'a.png' }, { name: 'b.png' }], 'Body', 'Cube', 'map', true), null);
});
test('nearby discovery includes textures/maps and is case-insensitive without duplicates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-textures-'));
  try { await mkdir(path.join(root, 'textures')); await writeFile(path.join(root, 'a.psd'), 'fixture'); await writeFile(path.join(root, 'textures', 'b.PNG'), 'fixture'); await writeFile(path.join(root, 'secret.txt'), 'x'); const result = await nearbyTextures(root, 'model://test/'); assert.equal(result.length, 2); assert.ok(result.some(file => file.url.endsWith('/textures/b.PNG'))); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('applying a texture to one mesh preserves shared material on other meshes and display modes', async () => {
  const root = new Group(), original = new MeshStandardMaterial();
  const a = new Mesh(new BoxGeometry(), original), b = new Mesh(new BoxGeometry(), original); root.add(a, b);
  const display = new DisplayManager(); display.attach(root); display.set('wire');
  const manager = new TextureManager(); manager.decode = async () => new Texture({ width: 1, height: 1 });
  await manager.apply(root, [{ name: 'color.png' }], { display, selected: a, explicit: true });
  assert.equal(b.material, display.wire); display.set('materials');
  assert.equal(b.material, original); assert.equal(b.material.map, null); assert.ok(a.material.map); assert.notEqual(a.material, original);
  assert.equal(meshStats(root).vertices, 48); assert.equal(meshStats(a).triangles, 12);
  display.dispose();
});
test('decode failure does not partially replace materials', async () => {
  const root = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); const material = root.material;
  const manager = new TextureManager(); manager.decode = async () => { throw new Error('broken PSD'); };
  await assert.rejects(manager.apply(root, [{ name: 'texture.psd' }], { explicit: true }), /broken PSD/);
  assert.equal(root.material, material); assert.equal(material.map, null);
});

test('failed referenced maps remain distinct and fall back to lit material', async () => {
  const material = new MeshStandardMaterial({ map: new Texture() }), root = new Mesh(new BoxGeometry(), material);
  const manager = new TextureManager(); manager.decode = async () => { throw new Error('Must not replace a named missing texture'); };
  await manager.apply(root, [{ name: 'PKM_d.tif' }]);
  assert.equal(clearMissingTextures(root), 1); assert.equal(material.map, null);
  assert.deepEqual(textureInfo('PKM_n.tif'), { slot: 'normalMap', stem: 'pkm' });
  assert.equal(chooseTexture([{ name: 'PKM_mg.tif' }], 'PKM_mat', 'base', 'map', true), null);
  assert.equal(chooseTexture([{ name: 'PKM_n.tif' }], 'PKM_mat', 'base', 'normalMap', false)?.name, 'PKM_n.tif');
});

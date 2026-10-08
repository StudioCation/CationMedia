import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Texture, DoubleSide, SRGBColorSpace } from 'three';
import { applySidecar, findSidecar } from '../src/managers/SidecarManager.mjs';
import { TextureManager } from '../src/managers/TextureManager.mjs';
import { nearbySidecar, sidecarTextureFiles } from '../electron/textureFiles.mjs';
import { discoverTextures } from '../electron/TextureDiscovery.mjs';

const definition = texture => ({ params: { base_color_texture: texture }, impion: { materialType: 'Lambert', side: 'DoubleSide' } });
function scene(...names) {
  const root = new Group(), shared = new MeshStandardMaterial();
  for (const name of names) { const mesh = new Mesh(new BoxGeometry(), shared); mesh.name = name; root.add(mesh); }
  return root;
}
const decoder = { decode: async asset => { const texture = new Texture({ width: 2, height: 2 }); texture.name = asset.name; return texture; } };

test('desktop automatically restores only referenced sibling textures before rendering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'viewer-sibling-'));
  try {
    await mkdir(path.join(root, 'models')); await mkdir(path.join(root, 'textures'));
    const file = path.join(root, 'models', 'hero.glb');
    const data = { objects: { hero: { materials: ['body', 'face'] } },
      materials: { body: definition('texture_hero'), face: definition('texture_face'), unused: definition('ui_icon') },
      textures: { texture_face: { format: 'webp' } } };
    await writeFile(file.replace('.glb', '.json'), JSON.stringify(data));
    for (const name of ['texture_hero.PNG', 'texture_face.webp', 'ui_icon.png']) await writeFile(path.join(root, 'textures', name), 'fixture');
    const sidecars = await nearbySidecar(file, 'model://test/');
    const discovery = await discoverTextures(file);
    const found = await sidecarTextureFiles(file, sidecars, sidecars, discovery.files);
    assert.deepEqual(found.map(asset => asset.name).sort(), ['texture_face.webp', 'texture_hero.PNG']);
    const model = scene('hero');
    model.children[0].geometry.clearGroups();
    model.children[0].geometry.addGroup(0, 18, 0); model.children[0].geometry.addGroup(18, 18, 1);
    const result = await applySidecar(model, data, found, { textures: decoder });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(model.children[0].material.map(material => material.map.name), ['texture_hero.PNG', 'texture_face.webp']);
    // Duplicate sibling names are ambiguous; a directly available map takes precedence.
    await mkdir(path.join(root, 'maps')); await writeFile(path.join(root, 'maps', 'texture_hero.PNG'), 'fixture');
    const duplicated = await discoverTextures(file);
    assert.deepEqual((await sidecarTextureFiles(file, sidecars, sidecars, duplicated.files)).map(asset => asset.name), ['texture_face.webp']);
    const available = [...sidecars, { name: 'texture_hero.PNG', url: 'model://test/texture_hero.PNG' }];
    assert.deepEqual((await sidecarTextureFiles(file, sidecars, available, duplicated.files)).map(asset => asset.name), ['texture_face.webp']);
    await writeFile(file.replace('.glb', '.json'), '{broken');
    assert.deepEqual(await sidecarTextureFiles(file, sidecars, [], discovery.files), []);
    assert.deepEqual(await sidecarTextureFiles(file, [], [], discovery.files), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('desktop discovers only a matching GLB/glTF JSON, case insensitive', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'viewer-sidecar-'));
  try {
    await writeFile(path.join(folder, 'WORLD.JSON'), '{}');
    await writeFile(path.join(folder, 'other.json'), '{}');
    const assets = await nearbySidecar(path.join(folder, 'world.glb'), 'model://test/');
    assert.deepEqual(assets, [{ name: 'WORLD.JSON', url: 'model://test/WORLD.JSON' }]);
    assert.equal(findSidecar({ name: 'world.glb', extension: 'glb', assets }), assets[0]);
    assert.equal(findSidecar({ name: 'other.glb', extension: 'glb', assets }), null);
    assert.deepEqual(await nearbySidecar(path.join(folder, 'world.obj'), 'model://test/'), []);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('separate atlases restore Blender names and preserve unmapped shared materials', async () => {
  const root = scene('truck.000', 'helicopter.000', 'untouched'), original = root.children[2].material;
  const assets = [{ name: 'atlas.png' }, { name: 'atlas_002.png' }];
  const data = { objects: { truck000: { materials: ['truck'] }, helicopter000: { materials: ['helicopter'] } },
    materials: { truck: definition('atlas'), helicopter: definition('atlas_002') } };
  const result = await applySidecar(root, data, assets, { textures: decoder });
  assert.equal(result.applied, 2); assert.deepEqual(result.warnings, []);
  const [truck, helicopter, untouched] = root.children;
  assert.equal(truck.material.map.name, 'atlas.png'); assert.equal(helicopter.material.map.name, 'atlas_002.png');
  assert.equal(truck.material.map.flipY, false); assert.equal(truck.material.map.colorSpace, SRGBColorSpace);
  assert.equal(truck.material.side, DoubleSide); assert.equal(truck.material.type, 'MeshLambertMaterial');
  assert.equal(untouched.material, original);
});

test('missing named maps are reported and never get the one unrelated nearby image', async () => {
  const root = scene('ground');
  const data = { objects: { ground: { materials: ['ground'] } }, materials: { ground: definition('missing_ground') } };
  const result = await applySidecar(root, data, [{ name: 'other.png' }], { textures: decoder });
  assert.deepEqual(result.warnings, ['Missing texture: missing_ground']);
  const manager = new TextureManager(); manager.decode = () => { throw new Error('must not guess'); };
  await manager.apply(root, [{ name: 'other.png' }]);
  await manager.apply(root, [{ name: 'other.png' }], { explicit: true, preserveSidecar: true });
  assert.equal(root.children[0].material.map, null);
});

test('one corrupt texture does not prevent valid maps from loading', async () => {
  const root = scene('a', 'b');
  const data = { objects: { a: { materials: ['a'] }, b: { materials: ['b'] } }, materials: { a: definition('bad'), b: definition('good') } };
  const result = await applySidecar(root, data, [{ name: 'bad.png' }, { name: 'good.png' }], {
    textures: { decode: asset => { if (asset.name === 'bad.png') throw new Error('broken'); return decoder.decode(asset); } }
  });
  assert.deepEqual(result.warnings, ['Unable to read texture: bad.png']);
  assert.equal(root.children[0].material.map, null); assert.equal(root.children[1].material.map.name, 'good.png');
});

test('glTF split primitives use the parent object and primitive index', async () => {
  const root = new Group(), parent = scene('primitive0', 'primitive1'); root.add(parent); parent.name = 'body';
  const parser = { json: { nodes: [{ name: 'original.body' }] }, associations: new Map([[parent, { nodes: 0 }],
    [parent.children[0], { primitives: 0 }], [parent.children[1], { primitives: 1 }]]) };
  const data = { objects: { originalbody: { materials: ['a', 'b'] } }, materials: { a: definition('a'), b: definition('b') } };
  const result = await applySidecar(root, data, [{ name: 'a.png' }, { name: 'b.png' }], { parser, textures: decoder });
  assert.equal(result.applied, 2); assert.deepEqual(parent.children.map(mesh => mesh.material.name), ['a', 'b']);
});

test('ambiguous normalized names and incomplete multi-material slots preserve imported material', async () => {
  const root = scene('a:b', 'multi'), originals = root.children.map(mesh => mesh.material);
  root.children[1].geometry.clearGroups();
  const data = { objects: { 'a.b': { materials: ['a'] }, ab: { materials: ['b'] }, multi: { materials: ['a', 'b'] } },
    materials: { a: definition('a'), b: definition('b') } };
  const result = await applySidecar(root, data, [], { textures: decoder });
  assert.equal(result.applied, 0); assert.deepEqual(root.children.map(mesh => mesh.material), originals);
});

test('malformed sidecar preserves geometry and material', async () => {
  const root = scene('a'), original = root.children[0].material;
  await assert.rejects(applySidecar(root, { materials: [] }, []), /dictionaries/);
  assert.equal(root.children[0].material, original);
});

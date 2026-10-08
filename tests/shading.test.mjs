import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshStandardMaterial, Group } from 'three';
import { ShadingManager } from '../src/managers/ShadingManager.mjs';
import { DisplayManager } from '../src/managers/DisplayManager.mjs';

test('shading edits only the selected mesh, preserves UV/groups and restores imported geometry', () => {
  const geometry = new BoxGeometry(0.001, 0.001, 0.001), material = new MeshStandardMaterial({ flatShading: true });
  const a = new Mesh(geometry, material), b = new Mesh(geometry, material), root = new Group(); root.add(a, b);
  const display = new DisplayManager(); display.attach(root); const shading = new ShadingManager(display);
  shading.set(a, 'smooth');
  const normal = a.geometry.attributes.normal;
  assert.ok(Math.abs(normal.getX(0)) > 0.2 && Math.abs(normal.getY(0)) > 0.2 && Math.abs(normal.getZ(0)) > 0.2);
  assert.equal(b.geometry, geometry); assert.equal(b.material, material); assert.equal(material.flatShading, true); assert.equal(a.material.flatShading, false);
  assert.equal(a.geometry.attributes.uv.count, 36); assert.deepEqual(a.geometry.groups, geometry.groups);
  shading.set(a, 'auto');
  assert.equal(a.geometry.attributes.normal.getX(0), 1); assert.equal(a.geometry.attributes.normal.getY(0), 0);
  shading.set(a, 'flat'); assert.equal(a.geometry.attributes.normal.getZ(0), 0);
  shading.set(a, 'original'); assert.equal(a.geometry, geometry); assert.equal(a.material.flatShading, true);
  shading.set(a, 'smooth'); display.set('normals'); shading.restore(); display.set('materials'); assert.equal(a.geometry, geometry);
});

test('whole-model shading includes hidden nested meshes and reports mixed modes', () => {
  const root = new Group(), group = new Group(), geometry = new BoxGeometry();
  const a = new Mesh(geometry, new MeshStandardMaterial()), b = new Mesh(geometry, new MeshStandardMaterial());
  b.visible = false; group.add(b); root.add(a, group);
  const display = new DisplayManager(); display.attach(root); const shading = new ShadingManager(display);
  shading.set(a, 'flat'); assert.equal(shading.scopeMode(root), 'mixed');
  for (const mode of ['smooth', 'auto', 'flat']) {
    shading.apply(root, mode); assert.equal(shading.mode(a), mode); assert.equal(shading.mode(b), mode); assert.equal(shading.scopeMode(root), mode);
  }
  shading.apply(root, 'original'); assert.equal(a.geometry, geometry); assert.equal(b.geometry, geometry); assert.equal(shading.scopeMode(root), 'original');
});

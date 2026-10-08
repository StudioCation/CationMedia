import { _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import UTIF from 'three/addons/libs/utif.module.js';

const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-revision-'));
const pixels = new Uint8Array(16 * 16 * 4);
for (let i = 0; i < pixels.length; i += 4) pixels.set([220, 60, 25, 255], i);
const tiff = path.join(folder, 'Body_d.tif'); await writeFile(tiff, new Uint8Array(UTIF.encodeImage(pixels.buffer, 16, 16)));
await writeFile(path.join(folder, 'panel.obj'), 'mtllib panel.mtl\no Panel\nv -1 -1 0\nv 1 -1 0\nv 1 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nusemtl Body\nf 1/1 2/2 3/3\n');
await writeFile(path.join(folder, 'panel.mtl'), 'newmtl Body\nKd 1 1 1\nmap_Kd Body_d.tif\n');
const server = process.env.VIEWER_EXECUTABLE ? null : await createServer({ server: { port: 5174, strictPort: true, host: '127.0.0.1' } });
await server?.listen();
const app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: process.env.VIEWER_EXECUTABLE ? '' : 'http://127.0.0.1:5174' } });
try {
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Viewer 3D', exact: true }).waitFor();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => i.label === 'Load 3D demo').click());
  await page.locator('#stats').filter({ hasText: '3 meshes' }).waitFor();
  assert.equal(await page.locator('footer,[data-resize=timeline],[data-view],#blender,#defaults').count(), 0);
  assert.equal(await page.locator('.display-panel .animation-panel').count(), 1);
  assert.equal(await page.locator('#stats-title').textContent(), 'Whole model');
  const bounds = await page.locator('.viewport-stats').boundingBox(), viewport = await page.locator('#viewport').boundingBox();
  assert.ok(bounds.x < viewport.x + 25 && bounds.y < viewport.y + 25);
  await page.keyboard.press('5'); assert.equal(await page.locator('#projection').textContent(), 'Orthographic');
  await page.keyboard.press('Numpad5'); assert.equal(await page.locator('#projection').textContent(), 'Perspective');
  await page.keyboard.press('7'); assert.equal(await page.locator('#projection').textContent(), 'Orthographic');
  await page.keyboard.press('4'); await page.keyboard.press('6');
  await page.locator('#search').fill('5'); assert.equal(await page.locator('#projection').textContent(), 'Orthographic'); await page.locator('#search').fill('');
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => item.label)); assert.deepEqual(menu, ['File', 'View', 'Settings']);
  const select = page.locator('.tree-name').filter({ has: page.locator('.material-names') }).first();
  await select.click(); assert.notEqual(await page.locator('#stats-title').textContent(), 'Whole model');
  await page.waitForTimeout(100);
  assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.some(item => /Convert|Save selected/.test(item.label))), false);
  const save = async (format, selected = false, prefix = 'model') => {
    const file = path.join(folder, `${prefix}.${format}`);
    await app.evaluate(({ dialog, BrowserWindow }, { file, format, selected }) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      BrowserWindow.getAllWindows()[0].webContents.send('app:command', { type: 'export', format, selected });
    }, { file, format, selected });
    await page.waitForFunction(name => document.querySelector('#message').textContent.includes(`Saved ${name}`) || document.querySelector('#message').textContent.includes('Unable to convert'), path.basename(file));
    assert.match(await page.locator('#message').textContent(), /Saved /);
    assert.ok((await stat(file)).size > 50);
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    return file;
  };
  await page.getByRole('button', { name: 'Normals', exact: true }).click();
  const selectedFile = await save('glb', true, 'selected');
  assert.equal(await page.getByRole('button', { name: 'Normals', exact: true }).getAttribute('aria-pressed'), 'true');
  await select.click(); assert.equal(await page.locator('#stats-title').textContent(), 'Whole model');
  const outputs = [];
  for (const format of ['glb', 'gltf', 'obj', 'stl', 'ply']) outputs.push(await save(format));
  const modelJSON = JSON.parse(await readFile(outputs[1], 'utf8'));
  assert.ok(modelJSON.animations?.length); assert.equal(modelJSON.meshes.length, 3);
  assert.ok(modelJSON.materials.some(m => m.pbrMetallicRoughness.baseColorFactor));
  for (const file of [selectedFile, ...outputs]) {
    await page.locator('#file-input').setInputFiles(file); await page.waitForFunction(name => document.querySelector('#filename').textContent === name && document.querySelector('#loading').hidden, path.basename(file));
    assert.equal(await page.locator('#message').isVisible(), false);
    assert.match(await page.locator('#stats').textContent(), file === selectedFile ? /1 meshes/ : /triangles/);
  }
  await page.locator('#file-input').setInputFiles(path.join(folder, 'panel.obj'));
  await page.waitForFunction(() => document.querySelector('#filename').textContent === 'panel.obj');
  assert.equal(await page.locator('#message').isVisible(), false);
  const textured = JSON.parse(await readFile(await save('gltf', false, 'textured'), 'utf8'));
  assert.ok(textured.images[0].uri.startsWith('data:image/png')); assert.ok(textured.materials[0].pbrMetallicRoughness.baseColorTexture);
  for (const format of ['png', 'jpg', 'webp']) {
    const file = path.join(folder, `texture.${format}`);
    await app.evaluate(({ Menu, dialog }, file) => { Menu.prototype.popup = function () { globalThis.textureContext = this; }; dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
    await page.locator('.tree-name').filter({ has: page.locator('.material-names') }).first().click({ button: 'right' });
    await app.evaluate((_, format) => { globalThis.textureContext.items.find(item => item.label === 'Convert To…').submenu.items.find(item => item.submenu && !item.label.startsWith('All textures')).submenu.items.find(item => item.label === format.toUpperCase()).click(); }, format);
    await page.waitForFunction(name => document.querySelector('#message').textContent.includes(`Saved ${name}`), path.basename(file));
    assert.ok((await stat(file)).size > 30); await page.getByRole('button', { name: 'Dismiss message' }).click();
  }
  if (process.env.VIEWER_PKM) {
    await page.locator('#file-input').setInputFiles(process.env.VIEWER_PKM);
    await page.waitForFunction(() => document.querySelector('#filename').textContent.toLowerCase() === 'pkm.fbx' && document.querySelector('#loading').hidden);
    assert.match(await page.locator('#message').textContent(), /Missing resources: 1/);
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await page.getByRole('button', { name: 'Materials', exact: true }).click();
    await page.keyboard.press('3'); await page.screenshot({ path: path.join(folder, 'pkm-tiff.png') });
    const json = JSON.parse(await readFile(await save('gltf', false, 'pkm'), 'utf8'));
    const body = json.materials.find(m => m.name === 'PKM_mat'), bipod = json.materials.find(m => m.name === 'PKM_soski_mat');
    assert.ok(body.pbrMetallicRoughness.baseColorTexture); assert.ok(body.normalTexture);
    assert.equal(bipod.pbrMetallicRoughness.baseColorTexture, undefined);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: native menus, layout, selection stats, projection shortcuts, five model exports/reopens, current-pose mesh export, TIFF import, texture conversion. Artifacts: ${folder}`);
} finally { await app.close(); await server?.close(); }

import { _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-context-'));
const server = process.env.VIEWER_EXECUTABLE ? null : await createServer({ server: { port: 5174, strictPort: true, host: '127.0.0.1' } });
await server?.listen();
const app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: process.env.VIEWER_EXECUTABLE ? '' : 'http://127.0.0.1:5174' } });
try {
  const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Viewer 3D', exact: true }).waitFor();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => i.label === 'Load 3D demo').click());
  await page.locator('#stats').filter({ hasText: '3 meshes' }).waitFor();
  await app.evaluate(({ Menu }, nativeStress) => {
    const popup = Menu.prototype.popup;
    globalThis.contextCount = 0;
    Menu.prototype.popup = function (options) { globalThis.contextMenu = this; globalThis.contextCount++; globalThis.contextClosed = new Promise(resolve => { options.callback = () => setTimeout(resolve, 150); }); if (nativeStress) return popup.call(this, options); options.callback(); };
  });
  const view = await page.locator('#viewport').boundingBox();
  await page.mouse.click(view.x + view.width / 2, view.y + view.height * 0.43, { button: 'right' });
  const labels = await app.evaluate(() => globalThis.contextMenu.items.map(item => item.label));
  assert.ok(labels.includes('Shade Smooth') && labels.includes('Shade Auto Smooth (30°)') && labels.includes('Shade Flat') && labels.includes('Convert To…'));
  await page.locator('.tree-row.selected').waitFor();
  const meshName = await page.locator('#stats-title').textContent();
  assert.notEqual(meshName, 'Whole model');
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.items.find(item => item.label === 'Shade Flat').click(); });
  await page.getByRole('button', { name: 'Solid', exact: true }).click();
  await page.screenshot({ path: path.join(folder, 'flat.png') });
  const selected = page.locator('.tree-row.selected .tree-name');
  await selected.click({ button: 'right' });
  assert.equal(await app.evaluate(() => globalThis.contextMenu.items.find(item => item.label === 'Shade Flat').checked), true);
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.items.find(item => item.label === 'Shade Smooth').click(); });
  await page.screenshot({ path: path.join(folder, 'smooth.png') });
  await selected.click({ button: 'right' });
  assert.equal(await app.evaluate(() => globalThis.contextMenu.items.find(item => item.label === 'Shade Smooth').checked), true);
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.items.find(item => item.label === 'Shade Auto Smooth (30°)').click(); });
  await selected.click({ button: 'right' });
  assert.equal(await app.evaluate(() => globalThis.contextMenu.items.find(item => item.label === 'Shade Auto Smooth (30°)').checked), true);
  const file = path.join(folder, 'mesh.glb');
  await app.evaluate(async ({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.items.find(item => item.label === 'Convert To…').submenu.items[0].click();
  }, file);
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Saved mesh.glb'));
  assert.ok((await stat(file)).size > 100);
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await selected.click({ button: 'right' });
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.items.find(item => item.label === 'Restore Imported Shading').click(); });
  await selected.click({ button: 'right' });
  assert.equal(await app.evaluate(() => globalThis.contextMenu.items.find(item => item.label === 'Restore Imported Shading').enabled), false);
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; });
  for (let i = 0; i < 12; i++) {
    await selected.click({ button: 'right' });
    await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; });
  }
  const count = await app.evaluate(() => globalThis.contextCount);
  await page.mouse.move(view.x + view.width / 2, view.y + view.height * 0.43); await page.mouse.down({ button: 'right' });
  await page.mouse.move(view.x + view.width / 2 + 70, view.y + view.height * 0.43 + 30, { steps: 8 }); await page.mouse.up({ button: 'right' });
  assert.equal(await app.evaluate(() => globalThis.contextCount), count, 'right drag must pan without opening menu');
  await page.mouse.click(view.x + 10, view.y + view.height - 10, { button: 'right' });
  assert.equal(await app.evaluate(() => globalThis.contextCount), count + 1, 'empty viewport opens whole-model menu');
  assert.equal(await page.locator('#stats-title').textContent(), 'Whole model');
  assert.equal(await page.locator('.tree-row.selected').count(), 0);
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.getMenuItemById('smooth').click(); });
  const meshRows = page.locator('.tree-name').filter({ has: page.locator('.material-names') });
  for (let i = 0; i < await meshRows.count(); i++) {
    await meshRows.nth(i).click({ button: 'right' });
    assert.equal(await app.evaluate(() => globalThis.contextMenu.getMenuItemById('smooth').checked), true);
    await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; });
  }
  // Switching the cached menu back to a single mesh must not retain whole-model scope.
  await meshRows.first().click({ button: 'right' });
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.getMenuItemById('flat').click(); });
  await page.mouse.click(view.x + 10, view.y + view.height - 10, { button: 'right' });
  assert.equal(await app.evaluate(() => ['smooth', 'auto', 'flat'].some(id => globalThis.contextMenu.getMenuItemById(id).checked)), false);
  await app.evaluate(async () => { globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.getMenuItemById('original').click(); });
  // Blank scene-tree space has the same whole-model scope.
  await page.locator('#tree').click({ button: 'right', position: { x: 20, y: (await page.locator('#tree').boundingBox()).height - 12 } });
  assert.equal(await page.locator('#stats-title').textContent(), 'Whole model');
  assert.equal(await app.evaluate(() => globalThis.contextMenu.getMenuItemById('original').enabled), false);
  const wholeFile = path.join(folder, 'whole.glb');
  await app.evaluate(async ({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    globalThis.contextMenu.closePopup(); await globalThis.contextClosed; globalThis.contextMenu.items.find(item => item.label === 'Convert To…').submenu.items[0].click();
  }, wholeFile);
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Saved whole.glb'));
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await page.locator('#file-input').setInputFiles(wholeFile); await page.waitForFunction(() => document.querySelector('#filename').textContent === 'whole.glb');
  assert.match(await page.locator('#stats').textContent(), /3 meshes/);
  await page.locator('#file-input').setInputFiles(file); await page.waitForFunction(() => document.querySelector('#filename').textContent === 'mesh.glb');
  assert.match(await page.locator('#stats').textContent(), /1 meshes/);
  assert.deepEqual(errors, []);
  console.log(`PASS: mesh menu descriptors/commands, viewport/tree selection, Smooth/Auto/Flat/Restore, selected GLB export/reopen, right-drag panning, empty click. Screenshots: ${folder}`);
} finally { await app.close(); await server?.close(); }

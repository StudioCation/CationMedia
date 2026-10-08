import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const folder = await mkdtemp(path.join(process.cwd(), '.image-tree-test-'));
const assets = path.join(folder, 'Assets');
const textures = path.join(assets, 'textures');
await mkdir(textures, { recursive: true });
await mkdir(path.join(assets, 'fonts'));
const input = path.join(textures, 'original.png');
await copyFile(new URL('../public/icon.png', import.meta.url), input);
for (let index = 0; index < 60; index++) await mkdir(path.join(assets, `folder-${String(index).padStart(2, '0')}`, 'child'), { recursive: true });
await copyFile(input, path.join(assets, 'folder-20', 'sample.png'));
for (const name of ['door_0.png', 'door_1.png', 'embedded_data_uri_1.png', 'embedded_data_uri_6.png', 'jump_r.png']) {
  await copyFile(input, path.join(textures, name));
}
let app, server;
const executablePath = process.env.VIEWER_EXECUTABLE || electronPath;
async function timed(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 15000); })]); }
  finally { clearTimeout(timer); }
}
try {
  if (!process.env.VIEWER_EXECUTABLE) {
    server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: false } });
    await server.listen();
    console.log('Vite ready');
  }
  app = await timed(electron.launch({ executablePath, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), input, `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: server?.resolvedUrls.local[0] || '' } }), 'Electron launch');
  console.log('Electron launched');
  const page = await timed(app.firstWindow(), 'First window');
  page.setDefaultTimeout(10000);
  console.log('First window:', await page.url());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await timed(page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer' && document.title.startsWith('original.png')), 'Viewer');
  console.log('Viewer loaded');
  await page.keyboard.press('Escape');
  await timed(page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor'), 'Editor');
  console.log('Editor opened');
  await timed(page.waitForFunction(() => document.querySelector('.image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'textures'), 'Tree path');
  console.log('Tree loaded');
  assert.equal(await page.locator('.image-tree-item').filter({ hasText: 'fonts' }).count(), 1);
  assert.equal(await page.locator('.image-file-row').count(), 6);
  assert.equal(await page.locator('.image-file-open img').first().evaluate(image => getComputedStyle(image).backgroundImage), 'none');
  const fileLayout = await page.evaluate(() => {
    const row = document.querySelector('.image-file-row').getBoundingClientRect();
    const details = document.querySelector('.image-file-details').getBoundingClientRect();
    const folder = document.querySelector('.image-tree-line.is-current .image-tree-folder').getBoundingClientRect();
    const tree = document.querySelector('.image-browser-tree').getBoundingClientRect();
    return { folderLeft: folder.left, rowLeft: row.left, rightInset: tree.right - row.right, detailsWidth: details.width };
  });
  assert.ok(fileLayout.rowLeft > fileLayout.folderLeft, `File rows should be indented inside their folder: ${JSON.stringify(fileLayout)}`);
  assert.ok(fileLayout.rightInset >= 0 && fileLayout.rightInset <= 24, `File rows should fit the tree width: ${JSON.stringify(fileLayout)}`);
  assert.ok(fileLayout.detailsWidth >= 120, `File names should have usable width: ${JSON.stringify(fileLayout)}`);
  if (process.env.IMAGE_TREE_SCREENSHOT) await page.locator('.image-browser').screenshot({ path: process.env.IMAGE_TREE_SCREENSHOT });
  await page.locator('.image-editor-layout').evaluate(el => el.style.setProperty('--image-browser-width', '260px'));
  const narrowLayout = await page.evaluate(() => ({
    panelWidth: document.querySelector('.image-browser').getBoundingClientRect().width,
    detailsWidth: document.querySelector('.image-file-details').getBoundingClientRect().width,
    rowRight: document.querySelector('.image-file-row').getBoundingClientRect().right,
    treeRight: document.querySelector('.image-browser-tree').getBoundingClientRect().right,
    overflowX: getComputedStyle(document.querySelector('.image-browser-content')).overflowX
  }));
  assert.ok(narrowLayout.detailsWidth >= 120, `File names should remain legible at minimum panel width: ${JSON.stringify(narrowLayout)}`);
  assert.ok(narrowLayout.treeRight - narrowLayout.rowRight >= 0 && narrowLayout.treeRight - narrowLayout.rowRight <= 24, `Narrow file rows should fit the tree width: ${JSON.stringify(narrowLayout)}`);
  assert.equal(narrowLayout.overflowX, 'auto');
  const horizontalScroll = await page.locator('.image-browser-content').evaluate(element => { element.scrollLeft = element.scrollWidth; return element.scrollLeft; });
  assert.ok(horizontalScroll > 0, 'Deeply nested files should be reachable by horizontal scrolling.');
  await page.locator('[data-image-action="view"]').click();
  const gridLayout = await page.evaluate(() => {
    const tree = document.querySelector('.image-browser-tree').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.image-file-row')].slice(0, 2).map(row => row.getBoundingClientRect());
    return { enabled: document.querySelector('.image-browser-list').classList.contains('is-grid'),
      firstRight: rows[0].right, secondLeft: rows[1].left, secondRight: rows[1].right, treeRight: tree.right };
  });
  assert.ok(gridLayout.enabled && gridLayout.firstRight < gridLayout.secondLeft && gridLayout.secondRight <= gridLayout.treeRight,
    `Thumbnail cells should fit side by side: ${JSON.stringify(gridLayout)}`);
  await page.locator('.image-tree-item').filter({ hasText: 'fonts' }).click();
  await timed(page.waitForFunction(() => document.querySelector('.image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'fonts'), 'Sibling folder');
  assert.equal(await page.locator('.image-file-row').count(), 0);
  const folderButton = name => page.locator(`.image-tree-item[data-entry-name="${name}"]`);
  await folderButton('folder-20').evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const position = async name => folderButton(name).evaluate(element => ({ top: element.getBoundingClientRect().top, left: document.querySelector('[data-role="browser-scroll"]').scrollLeft }));
  const clickStable = async (name, expand = false) => {
    const before = await position(name);
    await folderButton(name).evaluate(element => { window.__clickedFolder = element; });
    const button = expand ? folderButton(name).locator('..').locator('.image-tree-expand') : folderButton(name);
    const point = await button.evaluate(element => {
      const rect = element.getBoundingClientRect(), viewport = document.querySelector('[data-role="browser-scroll"]').getBoundingClientRect();
      return { x: (Math.max(rect.left, viewport.left) + Math.min(rect.right, viewport.right - 12)) / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
    const after = await position(name);
    const maxLeft = await page.locator('[data-role="browser-scroll"]').evaluate(element => element.scrollWidth - element.clientWidth);
    console.log(`Folder ${name}${expand ? ' expand button' : ''}:`, { before, after });
    assert.ok(Math.abs(after.top - before.top) < 1, 'Folder clicks must keep the clicked row in place within device-pixel rounding.');
    assert.ok(Math.abs(after.left - Math.min(before.left, maxLeft)) < 1, 'Horizontal scroll may only clamp when content shrinks.');
    assert.equal(await folderButton(name).evaluate(element => element === window.__clickedFolder), true, 'Existing folder buttons must retain DOM identity.');
  };
  await clickStable('folder-20');
  assert.equal(await page.locator('.image-file-row').count(), 1);
  await clickStable('folder-20');
  assert.equal(await page.locator('.image-file-row').isVisible(), false);
  await clickStable('folder-20');
  await clickStable('folder-20', true);
  await clickStable('folder-20', true);
  await clickStable('folder-21');
  assert.equal(await page.locator('.image-file-row').count(), 0);
  await clickStable('folder-22', true);
  await clickStable('folder-22', true);
  if (process.env.IMAGE_FOLDER_SCROLL_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_FOLDER_SCROLL_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log('PASS: native IPC tree path and sibling navigation.');
} finally {
  if (app) {
    try { await timed(app.close(), 'Electron close'); }
    catch { app.process().kill(); }
  }
  if (server) await server.close();
  const resolved = await realpath(folder).catch(() => null);
  if (resolved && path.dirname(resolved) === await realpath(process.cwd())) await rm(resolved, { recursive: true, force: true });
}

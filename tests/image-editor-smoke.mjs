import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const input = process.env.IMAGE_TEST_INPUT;
assert.ok(input, 'Set IMAGE_TEST_INPUT to a JPEG with a baked background.');
const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-editor-'));
const images = path.join(folder, 'images');
await mkdir(images);
const first = path.join(images, 'input.jpg');
await copyFile(input, first);
const textures = process.env.IMAGE_TEST_TEXTURE_DIR;
if (textures) {
  const destination = path.join(images, 'textures'); await mkdir(destination);
  const names = (await readdir(textures)).filter(name => /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(name));
  for (const name of [...new Set([...names.slice(0, 20), 'inventory_paint_icon_frame_0.png', 'end_win_ui_screen_1.png'])]) {
    if (names.includes(name)) await copyFile(path.join(textures, name), path.join(destination, name));
  }
}
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const executablePath = process.env.VIEWER_EXECUTABLE || electronPath;
let app, server;
try {
  if (process.env.IMAGE_TEST_DEV === '1') {
    server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: false } });
    await server.listen();
  }
  const url = server?.resolvedUrls.local[0] || '';
  app = await electron.launch({ executablePath, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), first, `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: url } });
  const page = await app.firstWindow(); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mediaType === 'image' && document.querySelector('.image-shell')?.dataset.mode === 'viewer');
  assert.ok((await page.title()).startsWith('input.jpg'));
  assert.equal(await page.locator('[data-role="canvas"]').evaluate(canvas => canvas.width === 800), true);
  const stackStyle = await page.locator('[data-role="stack"]').evaluate(el => {
    const style = getComputedStyle(el); return [style.backgroundImage, style.boxShadow];
  });
  assert.equal(stackStyle[0], 'none');
  assert.equal(stackStyle[1], 'none');
  if (process.env.IMAGE_TEST_VIEWER_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_TEST_VIEWER_SCREENSHOT });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  await page.setViewportSize({ width: 1500, height: 900 });
  const tools = await page.locator('[data-image-tool] > span:last-child').allTextContents();
  assert.deepEqual(tools, [...tools].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  assert.equal(await page.locator('.image-tool-row svg').count(), tools.length);
  assert.equal(await page.locator('[data-image-action="apply"]').count(), 0);
  assert.equal(await page.locator('[data-image-action="save"]').isVisible(), true);
  assert.equal(await page.locator('[data-image-action="save-as"]').isVisible(), true);
  const bounds = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    return { browser: rect('.image-browser').toJSON(), center: rect('.image-center').toJSON(), inspector: rect('.image-inspector').toJSON() };
  });
  assert.ok(bounds.browser.width >= 260 && bounds.browser.right <= bounds.center.left + 8, JSON.stringify(bounds));
  assert.ok(bounds.center.width >= 320 && bounds.center.right <= bounds.inspector.left + 2, JSON.stringify(bounds));
  await app.evaluate(({ Menu }) => {
    Menu.prototype.popup = function ({ callback } = {}) {
      globalThis.__imageSmokeMenu = this.items.map(item => ({ label: item.label, submenu: item.submenu?.items.map(child => child.label) }));
      callback?.();
    };
  });
  await page.locator('[data-role="canvas"]').click({ button: 'right' });
  await page.waitForTimeout(100);
  const stageMenu = await app.evaluate(() => globalThis.__imageSmokeMenu);
  assert.ok(stageMenu?.some(item => item.label === 'Tools' && item.submenu.includes('Auto cutout')));
  await page.locator('.image-file-row').first().click({ button: 'right' });
  await page.waitForTimeout(100);
  const fileMenu = await app.evaluate(() => globalThis.__imageSmokeMenu);
  assert.ok(fileMenu?.some(item => item.label === 'Open image'));
  const transparent = () => page.locator('[data-role="canvas"]').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0; for (let index = 3; index < data.length; index += 4) if (data[index] < 16) count++;
    return count;
  });
  assert.equal(await transparent(), 0);
  const cutout = page.locator('[data-image-toggle="auto-cutout"]');
  await cutout.check(); await page.waitForFunction(() => document.querySelectorAll('[data-history-index]').length === 2);
  assert.ok(await transparent() > 100000);
  await cutout.uncheck(); await page.waitForFunction(() => document.querySelectorAll('[data-history-index]').length === 3);
  assert.equal(await transparent(), 0);
  await cutout.check(); await page.waitForFunction(() => document.querySelectorAll('[data-history-index]').length === 4);
  assert.ok(await transparent() > 100000);
  await page.keyboard.press('Control+z'); await page.waitForFunction(() => document.querySelector('[data-history-index="2"]')?.getAttribute('aria-current') === 'step');
  assert.equal(await cutout.isChecked(), false);
  await page.keyboard.press('Control+y'); await page.waitForFunction(() => document.querySelector('[data-history-index="3"]')?.getAttribute('aria-current') === 'step');
  assert.equal(await cutout.isChecked(), true);
  if (process.env.IMAGE_TEST_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_TEST_SCREENSHOT });

  const savedAs = path.join(images, 'converted.png');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, savedAs);
  await page.locator('[data-image-action="save-as"]').click();
  await page.waitForFunction(() => document.title.startsWith('converted.png'));
  const before = await hash(savedAs);
  await page.locator('[data-image-tool="brightness"]').click();
  await page.locator('[data-image-toggle="brightness"]').check();
  await page.locator('[data-adjust="brightness"]').evaluate(input => {
    input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.title.includes(' *'));
  await page.locator('[data-image-action="save"]').click();
  await page.waitForFunction(() => !document.title.includes(' *'));
  assert.notEqual(await hash(savedAs), before);
  assert.ok(await hash(first));

  if (textures) {
    await page.locator('.image-tree-item').filter({ hasText: 'textures' }).click();
    await page.waitForFunction(() => document.querySelector('.image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'textures');
    await page.locator('[data-image-action="view"]').click();
    assert.equal(await page.locator('.image-browser-list').evaluate(el => el.classList.contains('is-grid')), true);
    const geometry = await page.locator('.image-file-row').evaluateAll(rows => rows.slice(0, 6).map(row => ({ row: row.getBoundingClientRect().toJSON(), image: row.querySelector('img').getBoundingClientRect().toJSON() })));
    assert.ok(geometry.length >= 4);
    for (const item of geometry) assert.ok(item.row.height >= item.image.height + 20 && item.image.bottom <= item.row.bottom + 1, JSON.stringify(item));
    assert.ok(geometry[2].row.top >= geometry[0].row.bottom + 3, JSON.stringify(geometry));
    if (process.env.IMAGE_TEST_GRID_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_TEST_GRID_SCREENSHOT });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.startDrag = options => { globalThis.__imageSmokeDrag = options; };
    });
    await page.locator('.image-file-row').first().evaluate(row => row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })));
    await page.waitForTimeout(100);
    const drag = await app.evaluate(() => globalThis.__imageSmokeDrag);
    assert.ok(drag?.file && path.isAbsolute(drag.file), 'File drag must provide a local absolute path.');
    await page.locator('.image-file-row').filter({ hasText: 'inventory_paint_icon_frame_0.png' }).locator('.image-file-open').click();
    await page.waitForFunction(() => document.title.startsWith('inventory_paint_icon_frame_0.png'));
    assert.equal(await page.locator('.image-shell').getAttribute('data-mode'), 'editor');
    const canvas = page.locator('[data-role="canvas"]');
    const width = await page.locator('[data-role="stack"]').evaluate(el => el.getBoundingClientRect().width);
    await canvas.click();
    const doubled = await page.locator('[data-role="stack"]').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(doubled >= width * 1.9);
    await canvas.hover(); await page.mouse.wheel(0, -100);
    const wheel = await page.locator('[data-role="stack"]').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(wheel > doubled);
    await page.locator('.image-file-row').filter({ hasText: 'end_win_ui_screen_1.png' }).locator('.image-file-open').click();
    await page.waitForFunction(() => document.title.startsWith('end_win_ui_screen_1.png'));
    await page.locator('[data-image-toggle="alpha-mask"]').check();
    const blue = await page.locator('[data-role="overlay"]').evaluate(overlay => {
      const data = overlay.getContext('2d').getImageData(0, 0, overlay.width, overlay.height).data;
      let count = 0; for (let index = 0; index < data.length; index += 4) if (data[index + 2] > data[index] + 30 && data[index + 3] > 200) count++;
      return count;
    });
    assert.ok(blue > 10000, `Partial alpha coverage should be visible; blue pixels: ${blue}`);
    if (process.env.IMAGE_TEST_ALPHA_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_TEST_ALPHA_SCREENSHOT });
    await page.locator('[data-role="stage"]').dblclick();
    await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: image UI, Save/Save As, effect toggles, history, zoom, Esc, file grid, drag bridge, and alpha mask.');
} finally {
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  if (server) await server.close();
  assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
  assert.match(path.basename(folder), /^cation-image-editor-/);
  await rm(folder, { recursive: true, force: true });
}

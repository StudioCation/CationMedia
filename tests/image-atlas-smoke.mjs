import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const source = process.env.IMAGE_ATLAS_FOLDER;
assert.ok(source, 'Set IMAGE_ATLAS_FOLDER to the twenty 640x640 PNG images.');
const names = (await readdir(source)).filter(name => name.endsWith('.png')).sort();
assert.equal(names.length, 20);
const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-atlas-test-'));
let app, server;
try {
  if (!process.env.VIEWER_EXECUTABLE) {
    server = await createServer({ server: { host: '127.0.0.1', port: 5185, strictPort: false } });
    await server.listen();
  }
  app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE || electronPath,
    args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), path.join(source, names[0]), `--user-data-dir=${path.join(folder, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: server?.resolvedUrls.local[0] || '' }
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(name => document.title.startsWith(name), names[0]);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  const browserToggle = page.locator('[data-image-action="toggle-browser"]');
  if (await browserToggle.getAttribute('aria-expanded') === 'false') await browserToggle.click();
  await page.locator('.image-file-row').first().waitFor();
  await page.locator('[data-image-action="select-all"]').click();
  await page.locator('[data-image-tool="atlas"]').click();
  assert.equal(await page.locator('[data-role="atlas-auto-size"]').isChecked(), true);
  assert.equal(await page.locator('[data-role="atlas-width"]').isVisible(), false);
  await page.locator('[data-image-toggle="atlas"]').click();
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.atlas === 'true');
  const dimensions = await page.locator('[data-role="canvas"]').evaluate(canvas => [canvas.width, canvas.height]);
  assert.deepEqual(dimensions, [2566, 3208]);
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, path.join(folder, 'atlas.png'));
  await page.locator('[data-image-action="save-as"]').click();
  let metadata;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { metadata = JSON.parse(await readFile(path.join(folder, 'atlas.json'), 'utf8')); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(metadata, 'Atlas PNG and JSON must be exported.');
  assert.equal(metadata.frames.length, 20);
  assert.deepEqual(metadata.frames.map(frame => path.basename(frame.name.replaceAll('/', path.sep))).sort(), names);
  assert.ok(metadata.frames.every(frame => frame.width === 640 && frame.height === 640));
  const png = await readFile(path.join(folder, 'atlas.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], dimensions);
  await page.locator('[data-role="atlas-mode"]').selectOption('grid');
  await page.waitForFunction(() => document.querySelector('[data-role="canvas"]').width === 2566);
  if (process.env.IMAGE_ATLAS_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_ATLAS_SCREENSHOT });
  await page.locator('[data-image-toggle="atlas"]').uncheck();
  await page.locator('[data-role="atlas-auto-size"]').uncheck();
  assert.equal(await page.locator('[data-role="atlas-width"]').isVisible(), true);
  await page.locator('[data-image-toggle="atlas"]').click();
  await page.waitForFunction(() => document.body.textContent.includes('Images do not fit inside the atlas limits.'));
  assert.equal(await page.locator('.image-shell').getAttribute('data-atlas'), 'false');
  await page.locator('[data-role="atlas-auto-size"]').check();
  assert.equal(await page.locator('[data-image-toggle="atlas"]').isChecked(), false, 'A failed build must not leave Atlas enabled.');
  await page.locator('[data-image-toggle="atlas"]').click();
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.atlas === 'true');
  assert.deepEqual(errors, []);
  console.log('PASS: twenty original 640x640 sprites produce a 2566x3208 atlas, PNG/JSON export, grid, manual limit error, and recovery.');
} finally {
  await app?.close(); await server?.close();
  assert.equal(path.dirname(folder), os.tmpdir()); assert.match(path.basename(folder), /^cation-atlas-test-/);
  await rm(folder, { recursive: true, force: true });
}

import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder = await mkdtemp(path.join(process.cwd(), '.image-keyboard-test-'));
let app, server;
try {
  for (let index = 0; index < 40; index++) {
    await copyFile(new URL('../public/icon.png', import.meta.url), path.join(folder, `image-${String(index).padStart(2, '0')}.png`));
  }
  server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  app = await electron.launch({ executablePath: electronPath,
    args: ['.', path.join(folder, 'image-20.png'), `--user-data-dir=${path.join(folder, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] }
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const current = name => page.waitForFunction(name => document.title.startsWith(name) && document.querySelector('#loading')?.hidden, name, { timeout: 3000 });
  await current('image-20.png');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  const toggle = page.locator('[data-image-action="toggle-browser"]');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const search = page.locator('[data-role="search"]');
  await search.fill('image-2');
  const rows = page.locator('.image-file-row');
  await rows.filter({ hasText: 'image-20.png' }).locator('input').check();
  await rows.filter({ hasText: 'image-21.png' }).locator('.image-file-open').click();
  await current('image-21.png');
  for (const [key, name] of [['ArrowDown', 'image-22.png'], ['ArrowRight', 'image-23.png'], ['ArrowUp', 'image-22.png'], ['ArrowLeft', 'image-21.png']]) {
    await page.keyboard.press(key);
    await current(name);
    assert.equal(await page.locator('.image-file-row.is-current .image-file-open').evaluate(element => element === document.activeElement), true);
    assert.equal(await search.inputValue(), 'image-2');
    assert.equal(await rows.filter({ hasText: 'image-20.png' }).locator('input').isChecked(), true);
  }
  // End of the filtered list must consume the arrow without scrolling or opening a hidden file.
  await rows.filter({ hasText: 'image-29.png' }).locator('.image-file-open').click();
  await current('image-29.png');
  const scroll = page.locator('[data-role="browser-scroll"]');
  const before = await scroll.evaluate(element => element.scrollTop);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  assert.ok((await page.title()).startsWith('image-29.png'));
  assert.equal(await scroll.evaluate(element => element.scrollTop), before);
  await search.focus();
  await page.keyboard.press('ArrowLeft');
  assert.ok((await page.title()).startsWith('image-29.png'), 'Search arrows must keep editing the query.');
  await page.locator('.image-browser-divider').focus();
  await page.keyboard.press('ArrowLeft');
  assert.ok((await page.title()).startsWith('image-29.png'), 'Divider arrows must keep resizing the panel.');
  await page.locator('[data-role="stage"]').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('ArrowRight');
  await current('image-30.png');
  await page.keyboard.press('ArrowLeft');
  await current('image-29.png');
  await page.evaluate(() => window.desktop.imageFullscreen(true));
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer');
  await page.keyboard.press('ArrowRight');
  await current('image-30.png');
  assert.deepEqual(errors, []);
  if (process.env.IMAGE_KEYBOARD_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_KEYBOARD_SCREENSHOT });
  console.log('PASS: arrow navigation in editor/viewer, focus, filter, boundary, input, divider, and selection preservation.');
} finally {
  await app?.close();
  await server?.close();
  assert.equal(path.dirname(folder), process.cwd());
  assert.match(path.basename(folder), /^\.image-keyboard-test-/);
  await rm(folder, { recursive: true, force: true });
}

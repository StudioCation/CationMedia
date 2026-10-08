import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const executablePath = process.env.VIEWER_EXECUTABLE || electronPath;
const appArgs = process.env.VIEWER_EXECUTABLE ? [] : ['.'];
const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-launch-'));
const profile = path.join(folder, 'profile');
const first = path.join(folder, 'first.png');
const second = path.join(folder, 'second.PNG');
await copyFile(new URL('../public/icon.png', import.meta.url), first);
await copyFile(first, second);

let app, server;
try {
  if (!process.env.VIEWER_EXECUTABLE) {
    server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: false } });
    await server.listen();
  }
  app = await electron.launch({ executablePath, args: [...appArgs, first, `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: server?.resolvedUrls.local[0] || '' } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mediaType === 'image' && document.querySelector('.image-shell')?.dataset.mode === 'viewer' && document.title.startsWith('first.png'));
  assert.equal(await page.locator('.image-workspace').isVisible(), true);
  assert.equal(await page.locator('[data-role="canvas"]').evaluate(canvas => canvas.width > 0 && canvas.height > 0), true);
  const fullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  await expect.poll(fullscreen).toBe(true);
  const stage = page.locator('[data-role="stage"]');
  await stage.hover(); await page.mouse.wheel(0, 120);
  await expect(page).toHaveTitle(/^second.PNG/);
  assert.equal(await page.locator('[data-role="zoom"]').inputValue(), 'fit');
  assert.equal(await fullscreen(), true);
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  await expect(page).toHaveTitle(/^second.PNG/);
  await page.mouse.wheel(0, -120);
  await expect(page).toHaveTitle(/^first.png/);
  assert.equal(await page.locator('[data-role="zoom"]').inputValue(), 'fit');
  if (process.env.IMAGE_TEST_VIEWER_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_TEST_VIEWER_SCREENSHOT });
  await page.locator('[data-role="stage"]').dblclick();
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  await expect.poll(fullscreen).toBe(false);
  await stage.hover(); await page.mouse.wheel(0, -120);
  await expect(page.locator('[data-role="zoom"]')).toHaveValue('custom');
  await expect(page).toHaveTitle(/^first.png/);
  assert.equal(await page.locator('#message').isVisible(), false, 'Image clicks must not invoke 3D display-mode warnings');
  await page.locator('[data-role="stage"]').dblclick();
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer');
  await expect.poll(fullscreen).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(fullscreen).toBe(false);
  await expect(page.locator('.image-shell')).toHaveAttribute('data-mode', 'editor');
  assert.equal(await page.locator('#message').isVisible(), false);

  const child = spawn(executablePath, [...appArgs, second, `--user-data-dir=${profile}`], { windowsHide: true, stdio: 'ignore' });
  try {
    await page.waitForFunction(() => document.title.startsWith('second.PNG') && document.querySelector('.image-shell')?.dataset.mode === 'viewer');
    assert.equal(await page.locator('[data-role="canvas"]').evaluate(canvas => canvas.width > 0 && canvas.height > 0), true);
    assert.equal(await page.locator('#message').isVisible(), false);
    await expect.poll(fullscreen).toBe(true);
    assert.deepEqual(errors, []);
    console.log('PASS: native fullscreen on first/forwarded image, double-click and Esc, wheel navigation in both directions and at folder boundary, fit zoom in viewer, editor wheel zoom, no renderer errors.');
  } finally {
    if (child.exitCode === null) child.kill();
  }
} finally {
  if (app) await app.close();
  if (server) await server.close();
  assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
  assert.match(path.basename(folder), /^cation-image-launch-/);
  await rm(folder, { recursive: true, force: true });
}

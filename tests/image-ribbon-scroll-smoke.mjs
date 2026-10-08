import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder = await mkdtemp(path.join(process.cwd(), '.image-ribbon-test-'));
let app, server;
const executablePath = process.env.VIEWER_EXECUTABLE || electronPath;
try {
  for (let index = 0; index < 70; index++) {
    await copyFile(new URL('../public/icon.png', import.meta.url), path.join(folder, `image-${String(index).padStart(2, '0')}.png`));
  }
  await writeFile(path.join(folder, 'image-22.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/dsAAAAASUVORK5CYII=', 'base64'));
  if (!process.env.VIEWER_EXECUTABLE) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  app = await electron.launch({ executablePath,
    args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), path.join(folder, 'image-30.png'), `--user-data-dir=${path.join(folder, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: server?.resolvedUrls.local[0] || '' }
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer' && document.title.startsWith('image-30.png'));
  await page.waitForFunction(() => document.querySelector('.image-tree-line.is-current'));
  const watchNavigation = async () => page.evaluate(() => {
    window.__navigationNodes = [...document.querySelectorAll('.image-file-row, .image-tree-line, .image-ribbon-item')];
    window.__navigationMutations = [];
    window.__navigationObserver?.disconnect();
    window.__navigationObserver = new MutationObserver(records => window.__navigationMutations.push(...records));
    for (const role of ['browser-tree', 'ribbon-list']) {
      window.__navigationObserver.observe(document.querySelector(`[data-role="${role}"]`), { childList: true, subtree: true });
    }
  });
  const assertNavigationStable = async () => {
    const state = await page.evaluate(() => ({
      retained: window.__navigationNodes.every(node => node.isConnected),
      mutations: window.__navigationMutations.length
    }));
    assert.deepEqual(state, { retained: true, mutations: 0 }, 'Image selection must retain the existing file, folder, and ribbon DOM.');
  };
  const list = page.locator('[data-role="ribbon-list"]');
  await page.mouse.move(400, 2);
  await page.locator('.image-ribbon').hover();
  // Keep the auto-hiding ribbon open while pointer movement and fullscreen layout settle.
  await list.locator('button').first().evaluate(element => element.focus({ preventScroll: true }));
  await page.waitForFunction(() => {
    const bounds = document.querySelector('.image-ribbon').getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  });
  await list.evaluate(element => { element.scrollLeft = 1600; });
  for (const side of ['left', 'right', 'left']) {
    const target = await list.evaluate((element, side) => {
      const bounds = element.getBoundingClientRect();
      const visible = [...element.querySelectorAll('button')].filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right && !button.classList.contains('is-current');
      });
      return (side === 'left' ? visible[0] : visible.at(-1)).textContent;
    }, side);
    const before = await list.evaluate(element => element.scrollLeft);
    await watchNavigation();
    await list.getByRole('button', { name: target, exact: true }).click();
    await page.waitForFunction(name => document.title.startsWith(name) && document.querySelector('.image-ribbon-item.is-current')?.textContent === name, target);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await list.evaluate(element => element.scrollLeft);
    console.log(`${target}: scrollLeft ${before} -> ${after}`);
    assert.equal(after, before, 'Selecting a visible thumbnail must preserve ribbon scroll.');
    await assertNavigationStable();
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  const browserToggle = page.locator('[data-image-action="toggle-browser"]');
  if (await browserToggle.getAttribute('aria-expanded') === 'false') await browserToggle.click();
  await page.evaluate(() => {
    window.__imageLoadingBounds = [];
    const loading = document.querySelector('#loading');
    new MutationObserver(() => {
      if (loading.hidden) return;
      const rect = element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      window.__imageLoadingBounds.push({ overlay: rect(loading), preview: rect(document.querySelector('[data-role="stage"]')) });
    }).observe(loading, { attributes: true, attributeFilter: ['hidden'] });
  });
  await page.locator('[data-role="search"]').fill('image-2');
  const rows = page.locator('.image-file-row');
  await rows.filter({ hasText: 'image-20.png' }).locator('input').check();
  for (const name of ['image-21.png', 'image-22.png']) {
    const button = rows.filter({ hasText: name }).locator('.image-file-open');
    await button.scrollIntoViewIfNeeded();
    const before = await page.locator('[data-role="browser-scroll"]').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
    await watchNavigation();
    await button.click();
    await page.waitForFunction(name => document.title.startsWith(name) && document.querySelector('.image-file-row.is-current')?.title === name, name);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertNavigationStable();
    const loadingBounds = await page.evaluate(() => window.__imageLoadingBounds.splice(0));
    assert.ok(loadingBounds.length, 'Opening an image must exercise the visible loading overlay.');
    for (const bounds of loadingBounds) assert.deepEqual(bounds.overlay, bounds.preview, 'Loading must cover only the image preview, leaving the file list and tools visible.');
    assert.deepEqual(await page.locator('[data-role="browser-scroll"]').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })), before);
    assert.equal(await page.locator('[data-role="search"]').inputValue(), 'image-2');
    assert.equal(await rows.filter({ hasText: 'image-20.png' }).locator('input').isChecked(), true);
    assert.equal(await button.evaluate(element => document.activeElement === element), true);
    assert.equal(await page.locator('.image-file-row.is-current').count(), 1);
    assert.equal(await page.locator('.image-ribbon-item.is-current').textContent(), name);
  }
  assert.equal(await page.locator('[data-role="canvas"]').evaluate(canvas => canvas.width), 1, 'The new image must still replace the preview.');
  await copyFile(new URL('../public/icon.png', import.meta.url), path.join(folder, 'image-23-new.png'));
  const refreshButton = rows.filter({ hasText: 'image-21.png' }).locator('.image-file-open');
  await refreshButton.scrollIntoViewIfNeeded();
  const beforeRefresh = await page.locator('[data-role="browser-scroll"]').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  await refreshButton.click();
  await page.waitForFunction(() => document.title.startsWith('image-21.png') && [...document.querySelectorAll('.image-file-row')].some(row => row.title === 'image-23-new.png'));
  assert.equal(await rows.count(), 11, 'Changed folder contents must refresh the filtered file list.');
  assert.equal(await page.locator('.image-ribbon-item').count(), 71, 'Changed folder contents must refresh the ribbon.');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterRefresh = await page.locator('[data-role="browser-scroll"]').evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  console.log('Folder refresh scroll:', { before: beforeRefresh, after: afterRefresh });
  assert.deepEqual(afterRefresh, beforeRefresh, 'Refreshing the current folder after selecting an image must preserve both scroll axes.');
  await page.locator('[data-role="search"]').fill('');
  const scroll = page.locator('[data-role="browser-scroll"]');
  await rows.filter({ hasText: 'image-40.png' }).locator('.image-file-open').evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const beforeSelection = await scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  await watchNavigation();
  await rows.filter({ hasText: 'image-40.png' }).locator('.image-file-open').click();
  await page.waitForFunction(() => document.title.startsWith('image-40.png'));
  for (const [key, name] of [['ArrowDown', 'image-41.png'], ['ArrowUp', 'image-40.png']]) {
    await page.keyboard.press(key);
    await page.waitForFunction(name => document.title.startsWith(name) && document.querySelector('.image-file-row.is-current .image-file-open') === document.activeElement, name);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })), beforeSelection, 'Navigation between visible rows must preserve scroll.');
    await assertNavigationStable();
  }
  await rows.filter({ hasText: 'image-41.png' }).locator('input').check();
  await rows.filter({ hasText: 'image-42.png' }).locator('.image-file-open').click({ modifiers: ['Control'] });
  await rows.filter({ hasText: 'image-43.png' }).locator('.image-file-open').click({ modifiers: ['Shift'] });
  await assertNavigationStable();
  assert.deepEqual(await scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })), beforeSelection);
  await page.locator('[data-image-action="select-all"]').click();
  await assertNavigationStable();
  assert.equal(await rows.locator('input:checked').count(), 71);
  assert.deepEqual(await scroll.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop })), beforeSelection);
  if (process.env.IMAGE_SCROLL_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_SCROLL_SCREENSHOT });
  await page.locator('[data-role="zoom"]').selectOption('4');
  await page.locator('[data-role="stage"]').evaluate(element => { element.scrollLeft = 200; element.scrollTop = 300; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('model:file', { pathPending: true }));
  await page.waitForFunction(() => !document.querySelector('#loading').hidden);
  const pendingBounds = await page.evaluate(() => window.__imageLoadingBounds.splice(0));
  assert.ok(pendingBounds.length);
  for (const bounds of pendingBounds) assert.deepEqual(bounds.overlay, bounds.preview, 'Loading must remain aligned with the preview after zooming and scrolling.');
  assert.equal(await page.locator('.image-inspector').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 20));
  }), true, 'The loading overlay must not cover the tools.');
  await rows.filter({ hasText: 'image-41.png' }).locator('input').uncheck();
  assert.equal(await rows.filter({ hasText: 'image-41.png' }).locator('input').isChecked(), false, 'File selection must remain accessible during loading.');
  if (process.env.IMAGE_LOADING_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_LOADING_SCREENSHOT });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('model:file', { error: 'Loading test failure' }));
  await page.waitForFunction(() => document.querySelector('#loading').hidden);
  assert.equal(await page.locator('#app > #loading').count(), 1, 'After failure the hidden loader must return to the document shell.');
  assert.deepEqual(errors, []);
  console.log('PASS: image selection preserves navigation DOM, scroll, filter, checks, and focus; loading covers only the preview, including after zoom and scroll, and clears on failure.');
} finally {
  await app?.close();
  await server?.close();
  assert.equal(path.dirname(folder), process.cwd());
  assert.match(path.basename(folder), /^\.image-ribbon-test-/);
  await rm(folder, { recursive: true, force: true });
}

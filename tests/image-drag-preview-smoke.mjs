import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { createServer } from 'vite';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder = await mkdtemp(path.join(process.cwd(), '.image-drag-test-'));
let app, server;
try {
  const original = path.join(folder, 'original.png');
  await copyFile(new URL('../public/icon.png', import.meta.url), original);
  const executablePath = process.env.VIEWER_EXECUTABLE || electronPath;
  if (!process.env.VIEWER_EXECUTABLE) {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
  }
  app = await electron.launch({ executablePath,
    args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), original, `--user-data-dir=${path.join(folder, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: server?.resolvedUrls.local[0] || '' }
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => document.title.startsWith('original.png'));
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160;
    const context = canvas.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 160, 160);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const source = path.join(folder, 'red.png');
  await writeFile(source, Buffer.from(fixture, 'base64'));
  const tiff = path.join(folder, 'red.tiff');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source, tiff], { windowsHide: true });
  const webp = path.join(folder, 'red.webp');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source, '-lossless', '1', webp], { windowsHide: true });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  const browserToggle = page.locator('[data-image-action="toggle-browser"]');
  if (await browserToggle.getAttribute('aria-expanded') === 'false') await browserToggle.click();
  const currentFolder = page.locator('.image-tree-line.is-current .image-tree-item');
  await currentFolder.click();
  await page.waitForFunction(() => document.querySelectorAll('.image-file-row').length === 4);
  await currentFolder.click();
  await app.evaluate(({ BrowserWindow, nativeImage }) => {
    BrowserWindow.getAllWindows()[0].webContents.startDrag = ({ file, files, icon }) => {
      const image = typeof icon === 'string' ? nativeImage.createFromPath(icon) : icon;
      globalThis.__dragResult = { file, files, size: image.getSize(), pixels: [...image.toBitmap()] };
    };
  });
  const rows = page.locator('.image-file-row');
  const row = name => rows.filter({ hasText: name });
  const clickFile = (name, modifiers = []) => row(name).locator('.image-file-open').click({ modifiers });
  const selected = () => rows.evaluateAll(elements => elements.filter(element => element.querySelector('input').checked).map(element => element.title));
  await clickFile('original.png');
  await clickFile('red.png', ['Control']);
  assert.deepEqual(await selected(), ['original.png', 'red.png'], 'Ctrl-click must add to the current selection.');
  assert.ok((await page.title()).startsWith('original.png'), 'Selection modifiers must not replace the preview.');
  await clickFile('red.png', ['Control']);
  assert.deepEqual(await selected(), ['original.png'], 'Ctrl-click must toggle a selected file off.');
  await clickFile('original.png');
  await clickFile('red.tiff', ['Shift']);
  assert.deepEqual(await selected(), ['original.png', 'red.png', 'red.tiff'], 'Shift-click must select the range from the anchor.');
  await clickFile('red.png', ['Shift']);
  assert.deepEqual(await selected(), ['original.png', 'red.png'], 'A shorter Shift range must replace the previous range.');
  await clickFile('red.webp', ['Control', 'Shift']);
  assert.deepEqual(await selected(), ['original.png', 'red.png', 'red.tiff', 'red.webp']);
  await row('red.png').dispatchEvent('dragstart');
  let batch;
  for (let attempt = 0; attempt < 100; attempt++) {
    batch = await app.evaluate(() => globalThis.__dragResult);
    if (batch) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(batch?.files, ['red.png', 'original.png', 'red.tiff', 'red.webp'].map(name => path.join(folder, name)), 'Dragging a selected file must pass the entire selected group to native drag.');
  assert.equal(await rows.locator('input:checked').count(), 4, 'Dragging must keep the selection.');
  for (const name of ['red.tiff', 'red.webp']) await row(name).locator('input').uncheck();
  await app.evaluate(() => { globalThis.__dragResult = null; });
  await row('red.tiff').dispatchEvent('dragstart');
  for (let attempt = 0; attempt < 100; attempt++) {
    batch = await app.evaluate(() => globalThis.__dragResult);
    if (batch) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(batch?.file, path.join(folder, 'red.tiff'));
  assert.equal(batch?.files?.length ?? 1, 1, 'Dragging an unselected file must not include another selection.');
  for (const name of ['original.png', 'red.png']) await row(name).locator('input').uncheck();
  const search = page.locator('[data-role="search"]');
  await search.fill('red.');
  await clickFile('red.png');
  await page.waitForFunction(() => document.title.startsWith('red.png') && document.querySelector('#loading').hidden);
  await clickFile('red.webp', ['Shift']);
  assert.deepEqual(await selected(), ['red.png', 'red.tiff', 'red.webp'], 'Shift range must include only the filtered images.');
  await page.locator('[data-image-action="view"]').click();
  assert.equal(await rows.filter({ has: page.locator('input:checked') }).count(), 3, 'Grid mode must retain the selection.');
  assert.equal(await rows.filter({ has: page.locator('input:checked') }).evaluateAll(elements => elements.every(element => element.classList.contains('is-selected'))), true);
  await row('red.tiff').locator('input').click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(), ['red.png', 'red.tiff'], 'Shift-click on a checkbox must also select a range.');
  for (const name of ['red.png', 'red.tiff']) await row(name).locator('input').uncheck();
  await page.locator('[data-image-action="view"]').click();
  await search.fill('');
  console.log('PASS: Ctrl/Shift selection and native multi-file payload.');
  for (const name of ['red.png', 'red.tiff', 'red.webp', 'original.png', 'red.png']) {
    await app.evaluate(() => { globalThis.__dragResult = null; });
    await page.locator('.image-file-row').filter({ hasText: name }).dispatchEvent('dragstart');
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await app.evaluate(() => globalThis.__dragResult);
      if (result) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(result, `Native drag should start for ${name}.`);
    assert.equal(result.file, path.join(folder, name));
    assert.ok(result.size.width <= 160 && result.size.height <= 160, 'Drag preview should fit 160px.');
    if (name.startsWith('red.')) {
      assert.deepEqual(result.size, { width: 160, height: 80 });
      const pixel = x => result.pixels.slice((40 * 160 + x) * 4, (40 * 160 + x) * 4 + 4);
      assert.deepEqual(pixel(40), [0, 0, 255, 255], 'Preview should show the dragged red file, not the open image or app icon.');
      assert.equal(pixel(120)[3], 0, 'Transparent pixels must remain transparent.');
    }
    console.log(`PASS: ${name} drag path and preview (${result.size.width}x${result.size.height}).`);
  }
  await page.locator('.image-file-row').filter({ hasText: 'red.webp' }).locator('.image-file-open').click();
  await page.waitForFunction(() => document.title.startsWith('red.webp'));
  if (await page.locator('.image-shell').getAttribute('data-mode') !== 'viewer') await page.locator('[data-role="stage"]').dblclick();
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer');
  for (const name of ['original.png', 'red.webp']) {
    const ribbonItem = page.locator('.image-ribbon-item').filter({ hasText: name });
    for (const target of [ribbonItem.locator('img'), ribbonItem.locator('span'), ribbonItem]) {
      await app.evaluate(() => { globalThis.__dragResult = null; });
      const cancelled = await target.evaluate(element => !element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })));
      assert.ok(cancelled, 'Ribbon drag must cancel the browser URL drag and start native file drag.');
      let result;
      for (let attempt = 0; attempt < 100; attempt++) {
        result = await app.evaluate(() => globalThis.__dragResult);
        if (result) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(result?.file, path.join(folder, name), 'Ribbon drag must provide the original local file to native applications.');
    }
    assert.equal(await ribbonItem.evaluate(element => element.draggable), true, 'The entire ribbon item must be draggable.');
    assert.equal(await ribbonItem.locator('img').evaluate(element => element.draggable), false, 'The thumbnail must not initiate a browser URL drag.');
  }
  console.log('PASS: viewer ribbon thumbnail, label, and tile use native file drag.');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'editor');
  await row('original.png').locator('input').check();
  await row('red.webp').locator('input').check();
  await page.locator('[data-role="stage"]').dblclick();
  await page.waitForFunction(() => document.querySelector('.image-shell')?.dataset.mode === 'viewer');
  await app.evaluate(() => { globalThis.__dragResult = null; });
  await page.locator('.image-ribbon-item').filter({ hasText: 'red.webp' }).dispatchEvent('dragstart');
  for (let attempt = 0; attempt < 100; attempt++) {
    batch = await app.evaluate(() => globalThis.__dragResult);
    if (batch) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(batch?.files, ['red.webp', 'original.png'].map(name => path.join(folder, name)), 'Ribbon must translate the browser selection across session roots.');
  console.log('PASS: filtered ranges, checkbox ranges, grid highlight, and group drag from the ribbon.');
} finally {
  await app?.close(); await server?.close();
  assert.equal(path.dirname(folder), process.cwd());
  assert.match(path.basename(folder), /^\.image-drag-test-/);
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

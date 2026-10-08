import { _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-viewer-modes-'));
const output = path.resolve('output/playwright/viewer-modes');
await mkdir(output, { recursive: true });
for (const colored of [true, false]) {
  await writeFile(path.join(folder, colored ? 'colored.ply' : 'plain.ply'), [
    'ply', 'format ascii 1.0', 'element vertex 4', 'property float x', 'property float y', 'property float z',
    ...(colored ? ['property uchar red', 'property uchar green', 'property uchar blue'] : []),
    'element face 2', 'property list uchar int vertex_indices', 'end_header',
    ...['-1 -1 0', '1 -1 0', '1 1 0', '-1 1 0'].map(position => `${position}${colored ? ' 255 0 0' : ''}`),
    '3 0 1 2', '3 0 2 3', '',
  ].join('\n'));
}
let server, app;
try {
  const executablePath = process.env.VIEWER_EXECUTABLE;
  if (!executablePath) {
    server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: false } });
    await server.listen();
  }
  app = await electron.launch({ executablePath, args: [...(executablePath ? [] : ['.']), '--force-color-profile=srgb', `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: server?.resolvedUrls.local[0] || '' } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const open = async name => {
    await page.locator('#file-input').setInputFiles(path.join(folder, name));
    await page.waitForFunction(name => document.querySelector('#filename')?.textContent === name && document.querySelector('#loading').hidden, name);
  };
  const vertex = page.getByRole('button', { name: 'Vertex colors', exact: true });
  const weights = page.getByRole('button', { name: 'Bone weights', exact: true });
  await open('colored.ply');
  await vertex.click();
  assert.equal(await vertex.getAttribute('aria-pressed'), 'true');
  await page.locator('#grid').uncheck();
  const screenshot = await page.locator('#viewport').screenshot({ path: path.join(output, 'vertex-colors.png') });
  const redPixels = await app.evaluate(({ nativeImage }, bytes) => {
    const bitmap = nativeImage.createFromBuffer(Buffer.from(bytes)).toBitmap();
    let red = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i + 2] > 220 && bitmap[i + 1] < 40 && bitmap[i] < 40) red++;
    return red;
  }, [...screenshot]);
  assert.ok(redPixels > 1000, `Vertex colors must render red; found ${redPixels} red pixels`);
  console.log('PASS: imported vertex colors render red in Electron.');
  await open('plain.ply');
  assert.equal(await vertex.isEnabled(), true, 'Vertex mode must remain clickable without color attributes');
  assert.equal(await vertex.getAttribute('aria-pressed'), 'true', 'Loading an uncolored model must retain vertex mode');
  await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await vertex.click();
  assert.equal(await vertex.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#message').isVisible(), false, 'Missing vertex colors must not block switching modes');
  assert.match(await vertex.getAttribute('title'), /gray/i);
  await page.locator('#viewport').screenshot({ path: path.join(output, 'vertex-without-colors.png') });
  assert.equal(await weights.isDisabled(), true);
  await open('colored.ply');
  assert.equal(await vertex.isEnabled(), true, 'Loading colored geometry must enable the mode again');
  await vertex.click();
  await page.locator('.modes').screenshot({ path: path.join(output, 'toolbar.png') });
  for (const mode of ['vertex', 'weights']) {
    const icon = page.locator(`.view-mode-${mode}`);
    assert.equal(await icon.textContent(), '');
    assert.equal(await icon.evaluate(async element => {
      const url = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
      if (!url) return false;
      const image = new Image(); image.src = url;
      try { await image.decode(); return true; } catch { return false; }
    }), true, `${mode} icon must load`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: vertex mode without colors, model changes, unavailable weights, icons, and renderer errors.');
} finally {
  await app?.close();
  await server?.close();
}

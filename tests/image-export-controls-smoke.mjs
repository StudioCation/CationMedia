import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

let browser, server;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 5179, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    window.__savedImages = [];
    window.__savedChanges = [];
    window.__savedAtlases = [];
    window.desktop = {
      saveImage: async (_id, payload) => { window.__savedImages.push(payload); return null; },
      imageSaveChanges: async (_id, payload) => { window.__savedChanges.push(payload); return { name: 'sample.jpg' }; },
      saveImageAtlas: async (_id, payload) => { window.__savedAtlases.push(payload); return null; }
    };
    const host = document.createElement('div');
    host.dataset.testImageExport = 'true';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#19191d';
    document.body.append(host);
    const { ImageWorkspace } = await import('/src/components/ImageWorkspace.mjs');
    const workspace = new ImageWorkspace(host);
    workspace.install({
      descriptor: { name: 'sample.jpg', preferredMode: 'editor', documentId: 'sample' },
      sourceURL: '/icon.png',
      pixels: { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 0, 10, 20, 30, 255]) }
    });
    window.__imageExportWorkspace = workspace;
  });
  const panel = page.locator('[data-test-image-export]');
  assert.equal(await panel.locator('[data-role="matte"], [data-role="format"]').count(), 0);
  assert.equal(await panel.locator('.image-stage-bar [data-role="zoom"]').isVisible(), true);
  assert.equal(await panel.locator('[data-role="stack"]').evaluate(element => getComputedStyle(element).backgroundImage), 'none');
  assert.notEqual(await panel.locator('.image-center').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => window.__imageExportWorkspace.onWindowFullscreen(true));
  assert.equal(await panel.locator('[data-role="stack"]').evaluate(element => getComputedStyle(element).backgroundImage), 'none');
  await page.evaluate(() => window.__imageExportWorkspace.onWindowFullscreen(false));
  if (process.env.IMAGE_EXPORT_SCREENSHOT) await panel.screenshot({ path: process.env.IMAGE_EXPORT_SCREENSHOT });

  await panel.locator('[data-image-action="save-as"]').click();
  await page.waitForFunction(() => window.__savedImages.length === 1);
  assert.equal(await page.evaluate(() => window.__savedImages[0].format), 'png');
  assert.equal(await page.evaluate(async () => {
    const image = new Image(); image.src = window.__savedImages[0].data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  }), 0);

  await panel.locator('[data-image-action="save"]').click();
  await page.waitForFunction(() => window.__savedImages.length === 2);
  assert.equal(await page.evaluate(() => window.__savedImages.at(-1).format), 'png');
  assert.equal(await page.evaluate(() => window.__savedChanges.length), 0);

  const converted = await page.evaluate(async () => {
    await window.__imageExportWorkspace.command('convert:jpg');
    const payload = window.__savedImages.at(-1);
    const image = new Image(); image.src = payload.data;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return { format: payload.format, transparentPixel: [...context.getImageData(0, 0, 1, 1).data] };
  });
  assert.equal(converted.format, 'jpg');
  assert.deepEqual(converted.transparentPixel, [255, 255, 255, 255]);

  await page.evaluate(async () => {
    const workspace = window.__imageExportWorkspace;
    workspace.history = [{ width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) }];
    workspace.index = 0;
    await workspace.save();
  });
  assert.equal(await page.evaluate(() => window.__savedChanges.length), 1);

  await page.evaluate(async () => {
    const workspace = window.__imageExportWorkspace;
    workspace.atlas = { sessionId: 'atlas', pixels: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }, frames: [] };
    workspace.atlasMode = true;
    await workspace.command('save-atlas:webp');
  });
  assert.equal(await page.evaluate(() => window.__savedAtlases[0].format), 'webp');
  console.log('PASS: transparent preview uses the workspace background; transparent JPEG saves as PNG, explicit JPEG conversion, and WebP atlas.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}

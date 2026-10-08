import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

let browser, server;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 5178, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.dataset.testImageLoop = 'true';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#19191d';
    document.body.append(host);
    const { ImageWorkspace } = await import('/src/components/ImageWorkspace.mjs');
    const workspace = new ImageWorkspace(host);
    const width = 16, height = 8, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      data.set([x * 12, y * 25, 100, 128], (y * width + x) * 4);
    }
    workspace.install({ descriptor: { name: 'texture.png', preferredMode: 'editor' }, sourceURL: '/icon.png', pixels: { width, height, data } });
    window.__imageLoopWorkspace = workspace;
  });

  const panel = page.locator('[data-test-image-loop]');
  await panel.locator('[data-image-tool="loop-texture"]').click();
  assert.equal(await panel.locator('[data-tool-panel="loop-texture"]').isVisible(), true);
  assert.equal(await panel.locator('[data-role="loop-size-value"]').textContent(), '128 × 128');
  const preview = panel.locator('[data-role="loop-surface"]');
  const previewState = () => preview.evaluate(surface => {
    const tile = surface.querySelector('[data-role="stack"]');
    return {
      active: surface.classList.contains('is-active'),
      previewWidth: surface.getBoundingClientRect().width,
      previewHeight: surface.getBoundingClientRect().height,
      tileWidth: tile.getBoundingClientRect().width,
      tileHeight: tile.getBoundingClientRect().height,
      tileVisibility: getComputedStyle(tile).visibility,
      image: getComputedStyle(surface).backgroundImage
    };
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-test-image-loop] [data-role="loop-surface"]')).backgroundImage.includes('blob:'));
  let state = await previewState();
  assert.equal(state.active, true);
  assert.equal(state.previewWidth, state.tileWidth * 3);
  assert.equal(state.previewHeight, state.tileHeight * 3);
  assert.equal(state.tileVisibility, 'hidden', 'the central tile must not double-composite transparency');
  assert.doesNotMatch(state.image, /repeating-conic-gradient/, 'transparent loop tiles use the workspace background');
  await panel.locator('[data-image-toggle="loop-texture"]').check();
  assert.equal(await page.evaluate(() => window.__imageLoopWorkspace.current().width), 128);
  await page.waitForFunction(() => document.querySelector('[data-test-image-loop] [data-role="canvas"]').width === 128 && getComputedStyle(document.querySelector('[data-test-image-loop] [data-role="loop-surface"]')).backgroundImage.includes('blob:'));
  state = await previewState();
  assert.equal(state.previewWidth, state.tileWidth * 3);
  assert.equal(state.previewHeight, state.tileHeight * 3);

  await panel.locator('[data-role="loop-size"]').evaluate(input => {
    input.value = '8';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await panel.locator('[data-role="loop-size-value"]').textContent(), '256 × 256');
  assert.equal(await page.evaluate(() => window.__imageLoopWorkspace.current().width), 256);
  await page.waitForFunction(() => document.querySelector('[data-test-image-loop] [data-role="canvas"]').width === 256 && getComputedStyle(document.querySelector('[data-test-image-loop] [data-role="loop-surface"]')).backgroundImage.includes('blob:'));
  state = await previewState();
  assert.equal(state.previewWidth, state.tileWidth * 3);
  assert.equal(state.previewHeight, state.tileHeight * 3);
  const exportSize = await page.evaluate(async () => {
    const image = new Image(); image.src = window.__imageLoopWorkspace.exportData('png'); await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  assert.deepEqual(exportSize, [256, 256], 'saving exports one tile rather than the tiling preview');
  const bounds = await preview.boundingBox();
  await page.mouse.move(bounds.x + state.tileWidth / 2, bounds.y + state.previewHeight / 2);
  await page.mouse.down();
  assert.equal((await previewState()).tileWidth, state.tileWidth * 2, 'press zoom works on a neighbouring tile');
  await page.mouse.up();
  assert.equal((await previewState()).tileWidth, state.tileWidth, 'release restores the preview scale');
  if (process.env.IMAGE_LOOP_SCREENSHOT) await panel.screenshot({ path: process.env.IMAGE_LOOP_SCREENSHOT });
  await panel.locator('[data-image-action="undo"]').click();
  assert.equal(await page.evaluate(() => window.__imageLoopWorkspace.current().width), 128);
  assert.equal(await panel.locator('[data-role="loop-size-value"]').textContent(), '128 × 128');
  await panel.locator('[data-image-action="redo"]').click();
  assert.equal(await page.evaluate(() => window.__imageLoopWorkspace.current().width), 256);
  await panel.locator('[data-role="loop-blend"]').evaluate(input => {
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await panel.locator('[data-role="loop-blend-value"]').textContent(), '40%');
  assert.equal(await page.evaluate(() => window.__imageLoopWorkspace.effects.find(effect => effect.id === 'loop-texture').params.blend), 40);
  await page.evaluate(() => window.__imageLoopWorkspace.onWindowFullscreen(true));
  assert.equal((await previewState()).active, false, 'fullscreen viewing shows a single image');
  await page.evaluate(() => window.__imageLoopWorkspace.onWindowFullscreen(false));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-test-image-loop] [data-role="loop-surface"]')).backgroundImage.includes('blob:'));
  assert.equal((await previewState()).active, true);
  await panel.locator('[data-image-toggle="loop-texture"]').uncheck();
  assert.equal(await page.evaluate(() => window.__imageLoopWorkspace.current().width), 16);
  assert.equal((await previewState()).active, true, 'the original also repeats for before/after comparison');
  await panel.locator('[data-image-tool="resize"]').click();
  assert.equal((await previewState()).active, false);
  assert.equal((await previewState()).tileVisibility, 'visible');
  console.log('PASS: Loop texture tiling preview, controls, output size, undo/redo, and disabling.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}

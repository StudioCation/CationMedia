import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

let browser, server;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 5181, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.dataset.testImageRotate = 'true';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#19191d';
    document.body.append(host);
    const { ImageWorkspace } = await import('/src/components/ImageWorkspace.mjs');
    const workspace = new ImageWorkspace(host);
    workspace.install({
      descriptor: { name: 'rotation.png', preferredMode: 'editor' },
      sourceURL: '/icon.png',
      pixels: { width: 2, height: 3, data: new Uint8ClampedArray([
        255, 0, 0, 255, 0, 0, 0, 0,
        0, 255, 0, 255, 0, 0, 0, 0,
        0, 0, 255, 255, 0, 0, 0, 0
      ]) }
    });
    window.__rotationWorkspace = workspace;
  });
  const panel = page.locator('[data-test-image-rotate]');
  assert.equal(await panel.locator('[data-image-tool="rotate"]').count(), 1);
  assert.equal(await panel.locator('[data-image-tool="rotate-left"], [data-image-tool="rotate-right"]').count(), 0);
  await panel.locator('[data-image-tool="rotate"]').click();
  assert.equal(await panel.locator('[data-tool-panel="rotate"]').isVisible(), true);
  const slider = panel.locator('[data-role="rotate-angle"]');
  await slider.evaluate(element => { element.value = '45'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  const preview = await page.evaluate(() => ({
    size: [window.__rotationWorkspace.visiblePixels().width, window.__rotationWorkspace.visiblePixels().height],
    history: window.__rotationWorkspace.history.length,
    angle: window.__rotationWorkspace.q('rotate-angle-value').textContent,
    checked: window.__rotationWorkspace.el.querySelector('[data-image-toggle="rotate"]').checked
  }));
  assert.deepEqual(preview, { size: [4, 4], history: 1, angle: '+45°', checked: true });
  if (process.env.IMAGE_ROTATE_SCREENSHOT) await panel.locator('.image-inspector').screenshot({ path: process.env.IMAGE_ROTATE_SCREENSHOT });
  await slider.evaluate(element => element.dispatchEvent(new Event('change', { bubbles: true })));
  assert.deepEqual(await page.evaluate(() => [window.__rotationWorkspace.history.length, window.__rotationWorkspace.historyLabels.at(-1)]), [2, 'Rotate +45°']);
  assert.deepEqual(await page.evaluate(async () => {
    const image = new Image(); image.src = window.__rotationWorkspace.exportData('png'); await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }), [4, 4]);
  await page.evaluate(() => window.__rotationWorkspace.command('undo'));
  assert.deepEqual(await page.evaluate(() => [
    window.__rotationWorkspace.visiblePixels().width,
    window.__rotationWorkspace.visiblePixels().height,
    window.__rotationWorkspace.q('rotate-angle').value,
    window.__rotationWorkspace.el.querySelector('[data-image-toggle="rotate"]').checked
  ]), [2, 3, '0', false]);
  console.log('PASS: one rotation tool previews angle, records one edit, and restores on undo.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}

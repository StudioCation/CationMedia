import { musicFixture } from './music-fixture.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { encodeWave } from '../shared/audio.mjs';

const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-audio-performance-'));
const rate = 44100, duration = 193, file = path.join(folder, 'long-stereo.wav');
const { channels } = musicFixture({ rate, seconds: duration });
await writeFile(file, encodeWave(channels, rate));
const baseline = process.env.AUDIO_BASELINE === '1', label = baseline ? 'before' : 'after';
await mkdir('artifacts/audio', { recursive: true });
const app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), file, `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '' } });
try {
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => document.querySelector('#audio-info')?.textContent.includes('03:13.000'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.perf = { events: [], strokes: 0, frames: [], previous: 0, running: true, dimmed: 0, gpuDraws: 0 };
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...args) { if (this.canvas.id === 'audio-wave') { window.perf.strokes++; if (Math.abs(this.globalAlpha - .2) < .001) window.perf.dimmed++; } return stroke.apply(this, args); };
    const fill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args) { if (this.canvas.id === 'audio-wave') { window.perf.strokes++; if (Math.abs(this.globalAlpha - .2) < .001) window.perf.dimmed++; } return fill.apply(this, args); };
    const draw = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (...args) { window.perf.gpuDraws++; return draw.apply(this, args); };
    const area = document.querySelector('#audio-wave-area'), move = area.onpointermove;
    area.onpointermove = event => { const start = performance.now(); move(event); window.perf.events.push(performance.now() - start); };
    const tick = now => { const perf = window.perf; if (perf.previous) perf.frames.push(now - perf.previous); perf.previous = now; if (perf.running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const box = await page.locator('#audio-wave-area').boundingBox(), x = box.x + 52, width = box.width - 54, y = box.y + box.height * .65;
  await page.mouse.move(x + width * .1, y); await page.mouse.down();
  await page.mouse.move(x + width * .8, y, { steps: 100 }); await page.mouse.up();
  const measured = await page.evaluate(() => {
    const p = window.perf; p.running = false;
    const samples = [...p.events].sort((a, b) => a - b), frames = [...p.frames].sort((a, b) => a - b);
    return { pointerEvents: samples.length, handlerP95Ms: samples[Math.floor(samples.length * .95)], handlerMaxMs: samples.at(-1), frameP95Ms: frames[Math.floor(frames.length * .95)], waveformStrokesDuringDrag: p.strokes };
  });
  if (!baseline) assert.equal(measured.waveformStrokesDuringDrag, 0, 'Selection must not redraw the waveform');
  await page.locator('#audio-clear').click();
  const started = Date.now(); await page.locator('#audio-find-loops').click();
  await page.locator(baseline ? '.audio-loop-result' : '.audio-loop-region').first().waitFor();
  measured.loopFinderMs = Date.now() - started;
  if (!baseline) {
    assert.equal(await page.evaluate(() => window.perf.dimmed), 2, 'Each channel renders non-loop samples at alpha 0.2');
    await page.screenshot({ path: 'artifacts/audio/loop-regions.png' });
    await page.locator('.audio-loop-region').first().click();
    const loopClock = await page.locator('#audio-clock').textContent();
    await page.waitForFunction(clock => document.querySelector('#audio-clock').textContent !== clock, loopClock);
    await page.locator('#audio-stop').click();
    await page.locator('#audio-clear-loops').click(); await page.waitForTimeout(80);
    assert.equal(await page.locator('.audio-loop-region').count(), 0);
    const effectLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Effects').submenu.items.map(i => i.label));
    assert.equal(effectLabels.length, 8);
    for (const label of effectLabels) {
      await app.evaluate(({ Menu }, label) => Menu.getApplicationMenu().items.find(i => i.label === 'Effects').submenu.items.find(i => i.label === label).click(), label);
      assert.equal(await page.locator('#audio-effect-dialog').isVisible(), true);
      await page.locator('#audio-effect-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => i.label === 'Load 3D demo').click());
    await page.locator('#stats').filter({ hasText: '3 meshes' }).waitFor();
    await page.locator('#rotate').check();
    await page.locator('#file-input').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('#app').dataset.mediaType === 'audio');
    await page.waitForTimeout(100); await page.evaluate(() => window.perf.gpuDraws = 0); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.perf.gpuDraws), 0, 'Hidden 3D must not render');
  }
  assert.deepEqual(errors, []);
  await writeFile(`artifacts/audio/performance-${label}.json`, JSON.stringify(measured, null, 2));
  console.log(label, JSON.stringify(measured));
} finally { await app.close(); }

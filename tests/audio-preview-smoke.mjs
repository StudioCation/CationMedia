import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { encodeWave, decodeWave } from '../shared/audio.mjs';
import { selectRange } from './audio-helpers.mjs';
const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-preview-'));
const file = path.join(folder, 'preview.wav'), rate = 44100;
const channels = [440, 660].map(hz => Float32Array.from({ length: rate * 3 }, (_, i) => .3 * Math.cos(i * Math.PI * 2 * hz / rate)));
await writeFile(file, encodeWave(channels, rate)); await mkdir('artifacts/audio', { recursive: true });
const app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), file, `--user-data-dir=${path.join(folder, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '' } });
try {
  const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => document.querySelector('.audio-workspace')?.dataset.name === 'preview.wav');
  assert.equal(await page.locator('#defaults-dialog').isVisible(), false);
  await page.evaluate(() => {
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop, connect = GainNode.prototype.connect;
    AudioBufferSourceNode.prototype.start = function (...args) { window.previewSource = this; window.previewStarts = (window.previewStarts || 0) + 1; this.testStopped = false; return start.apply(this, args); };
    AudioBufferSourceNode.prototype.stop = function (...args) { this.testStopped = true; return stop.apply(this, args); };
    GainNode.prototype.connect = function (...args) { window.previewGain = this; return connect.apply(this, args); };
  });
  await selectRange(page, .5, 2.5, 3);
  const menu = (group, label) => app.evaluate(({ Menu }, { group, label }) => Menu.getApplicationMenu().items.find(i => i.label === group).submenu.items.find(i => i.label === label).click(), { group, label });
  const ready = () => page.waitForFunction(() => document.querySelector('#loading').hidden);
  const audition = async mode => {
    const count = await page.evaluate(() => window.previewStarts || 0);
    await page.locator(`#audio-preview-${mode}`).click();
    await page.waitForFunction(count => window.previewStarts > count, count);
  };
  const slider = async value => page.locator('#audio-effect-slider').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  await menu('Effects', 'Volume…'); await slider(50);
  assert.equal(await page.locator('#audio-gain').inputValue(), '50');
  await audition('before'); await audition('after');
  assert.ok(Math.abs(await page.evaluate(() => window.previewGain.gain.value) - .5) < .001);
  const starts = await page.evaluate(() => window.previewStarts);
  await slider(25); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.previewStarts), starts, 'Volume slider must update without restarting playback');
  await page.waitForFunction(() => Math.abs(window.previewGain.gain.value - .25) < .001);
  assert.equal(await page.locator('#audio-undo').isDisabled(), true, 'Preview must not modify history');
  await page.screenshot({ path: 'artifacts/audio/volume-preview.png' });
  const dialogBox = await page.locator('#audio-effect-dialog').boundingBox(), applyBox = await page.locator('#audio-apply-effect').boundingBox();
  assert.ok(Math.abs(dialogBox.x + dialogBox.width - applyBox.x - applyBox.width) < 2);
  assert.equal(await page.locator('#audio-effect-title').evaluate(el => getComputedStyle(el).fontWeight), '400');
  await page.locator('#audio-effect-dialog .dialog-close').click();
  await page.waitForFunction(() => window.previewSource.testStopped);
  assert.match(await page.locator('#audio-state').textContent(), /Ready/);
  for (const [label, id, value] of [['Pitch…', 'pitch', 5], ['Time stretch…', 'stretch', 150], ['Fade in…', 'fade', .5], ['Fade out…', 'fade', .5], ['Chorus…', 'chorus', 70], ['Distortion…', 'distortion', 45], ['Smoothness…', 'smooth', 75]]) {
    console.log('Preview:', label); await menu('Effects', label); await slider(value); assert.equal(Number(await page.locator(`#audio-${id}`).inputValue()), value);
    await audition('before');
    const original = await page.evaluate(() => Array.from(window.previewSource.buffer.getChannelData(0)));
    await audition('after');
    const rendered = await page.evaluate(() => Array.from(window.previewSource.buffer.getChannelData(0)));
    assert.notDeepEqual(rendered, original, label);
    assert.equal(await page.locator('#audio-undo').isDisabled(), true);
    await page.locator('#audio-preview-stop').click(); assert.equal(await page.evaluate(() => window.previewSource.testStopped), true);
    if (id === 'stretch') {
      await page.locator('#audio-apply-effect').click(); await ready();
      const output = path.join(folder, 'applied.wav');
      await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }); }, output);
      await menu('File', 'Save as / Convert…'); await page.locator('#audio-format').selectOption('wav'); await page.locator('#audio-quality').selectOption('maximum');
      await page.locator('#audio-save').click(); await ready(); await page.locator('#message button').click();
      assert.deepEqual(Array.from(decodeWave(new Uint8Array(await readFile(output))).channels[0]), rendered, 'Applied effect must match audition exactly');
      await page.locator('#audio-undo').click();
    } else { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#audio-effect-dialog').open); }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
  await menu('Effects', 'Volume…');
  await page.waitForTimeout(100); await page.screenshot({ path: 'artifacts/audio/effect-minimum-window.png' });
  for (const selector of ['.dialog-titlebar', '.dialog-actions', '#audio-effect-slider', '.audio-audition']) {
    const box = await page.locator('#audio-effect-dialog').locator(selector).boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.y + box.height <= await page.evaluate(() => innerHeight), selector);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: live gain slider, before/after for all 8 effects, unchanged document/history, exact audition/apply samples, cancel stops audio, CationUI title/actions, minimum-window layout.');
} finally { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {}); await app.close(); }

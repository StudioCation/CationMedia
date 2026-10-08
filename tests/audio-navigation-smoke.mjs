import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import { musicFixture } from './music-fixture.mjs';
import { encodeWave } from '../shared/audio.mjs';
import { selectRange, playbackRange } from './audio-helpers.mjs';
const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-navigation-'));
const duration = 193, rate = 44100, file = path.join(folder, 'navigation.wav');
await writeFile(file, encodeWave(musicFixture({ rate, seconds: duration }).channels, rate));
await mkdir('artifacts/audio', { recursive: true });
const app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), file, `--user-data-dir=${folder}/profile`], env: { ...process.env, VITE_DEV_SERVER_URL: '' } });
try {
  const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('.audio-workspace')?.dataset.name === 'navigation.wav');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 850));
  await page.evaluate(() => {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.navigationSource = this; window.navigationStarts = (window.navigationStarts || 0) + 1; return start.apply(this, args); };
    window.wheelPaints = [];
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...args) { if (this.canvas.id === 'audio-wave') window.wheelPaints.push(performance.now()); return stroke.apply(this, args); };
  });
  const viewport = () => page.locator('#audio-scroll').evaluate(el => ({ offset: Number(el.value), span: 193 - Number(el.max) }));
  const point = async (t, y = .6) => { const box = await page.locator('#audio-wave-area').boundingBox(), view = await viewport(); return { x: box.x + 52 + (t - view.offset) / view.span * (box.width - 52), y: box.y + box.height * y }; };
  const dragHandle = async (id, to) => {
    const handle = page.locator(`#audio-selection-${id}`); await handle.waitFor({ state: 'visible' });
    const box = await handle.boundingBox(), target = await point(to, .1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await handle.evaluate(el => getComputedStyle(el).cursor), 'ew-resize');
    await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
  };
  const selected = await selectRange(page, 40, 80, duration);
  await dragHandle('start', 30); let range = await playbackRange(page);
  assert.ok(Math.abs(range[0] - 30) < .3); assert.equal(range[1], selected[1]);
  await page.locator('#audio-loop').click(); await page.locator('#audio-play').click();
  const starts = await page.evaluate(() => window.navigationStarts);
  await dragHandle('end', 100);
  await page.waitForFunction(count => window.navigationStarts > count, starts);
  const playing = await page.evaluate(() => ({ count: window.navigationStarts, start: window.navigationSource.loopStart, end: window.navigationSource.loopEnd, loop: window.navigationSource.loop }));
  assert.equal(playing.count, starts + 1, 'Resize should resume once, not on each pointer move');
  assert.equal(playing.start, range[0]); assert.ok(Math.abs(playing.end - 100) < .3); assert.equal(playing.loop, true);
  await page.locator('#audio-stop').click();
  const area = await page.locator('#audio-wave-area').boundingBox(), x = Math.floor(area.x + 52 + (area.width - 52) * .38), fraction = (x - area.x - 52) / (area.width - 52), y = area.y + area.height * .6;
  await page.mouse.move(x, y); const initial = await viewport(), anchor = initial.offset + initial.span * fraction;
  const elapsed = performance.now();
  for (let i = 0; i < 10; i++) {
    const before = await viewport(); await page.mouse.wheel(0, -100);
    await page.waitForFunction(span => 193 - Number(document.querySelector('#audio-scroll').max) < span, before.span);
    const after = await viewport(); assert.ok(Math.abs(after.offset + after.span * fraction - anchor) < .001, JSON.stringify({after,anchor,fraction,diff:after.offset+after.span*fraction-anchor}));
  }
  const zoomed = await viewport();
  assert.ok(zoomed.span < 4, 'Ten wheel steps should zoom into a short phrase');
  // Tiny trackpad deltas must not behave like a full wheel notch.
  await page.mouse.wheel(0, -1); await page.waitForFunction(span => 193 - Number(document.querySelector('#audio-scroll').max) < span, zoomed.span);
  const tiny = await viewport(); assert.ok(tiny.span / zoomed.span > .99);
  await page.mouse.wheel(100, 0); await page.waitForFunction(offset => Number(document.querySelector('#audio-scroll').value) > offset, tiny.offset);
  const panned = await viewport(); assert.ok(Math.abs(panned.span - tiny.span) < .0001);
  await page.locator('#audio-fit').click(); await page.waitForFunction(() => Number(document.querySelector('#audio-scroll').max) === 0);
  await page.locator('#audio-loop').click(); await page.locator('#audio-clear').click();
  await page.locator('#audio-find-loops').click(); await page.locator('.audio-loop-region').first().waitFor();
  await page.locator('.audio-loop-region').first().click(); await page.locator('#audio-stop').click();
  const found = await page.evaluate(() => [window.navigationSource.loopStart, window.navigationSource.loopEnd]);
  await dragHandle('end', found[1] + 2); range = await playbackRange(page);
  assert.equal(range[0], found[0]); assert.ok(Math.abs(range[1] - found[1] - 2) < .3);
  assert.equal(await page.locator('#audio-loop').getAttribute('aria-pressed'), 'true');
  await page.locator('#audio-zoom-selection').click(); await page.screenshot({ path: 'artifacts/audio/draggable-boundaries.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: independent selection edges, one playback resume, found-loop resizing, pointer-anchored wheel zoom, proportional trackpad deltas, horizontal pan; navigation sequence ms:', Math.round(performance.now() - elapsed));
} finally { await app.close(); }



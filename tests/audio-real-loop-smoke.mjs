import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const file = process.env.AUDIO_TEST_FILE;
if (!file) throw new Error('Set AUDIO_TEST_FILE to the real music regression fixture.');
const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-real-loop-'));
await mkdir('artifacts/audio', { recursive: true });
const app = await electron.launch({ executablePath: process.env.VIEWER_EXECUTABLE, args: [...(process.env.VIEWER_EXECUTABLE ? [] : ['.']), file, `--user-data-dir=${folder}`], env: { ...process.env, VITE_DEV_SERVER_URL: '' } });
try {
  const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(name => document.querySelector('.audio-workspace')?.dataset.name === name, path.basename(file));
  await page.evaluate(() => {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { window.loopTestSource = this; return start.apply(this, args); };
  });
  const started = Date.now(); await page.locator('#audio-find-loops').click();
  await page.locator('.audio-loop-region').first().waitFor();
  const elapsed = Date.now() - started;
  assert.equal(await page.locator('#message').isVisible(), false);
  const count = await page.locator('.audio-loop-region').count();
  assert.ok(count >= Number(process.env.AUDIO_EXPECT_MIN_LOOPS || 1));
  const results = [];
  for (let i = 0; i < count; i++) {
    const region = page.locator('.audio-loop-region').nth(i), title = await region.getAttribute('title');
    assert.match(title, /BPM.*bars/); assert.match(title, /Join level mismatch/);
    await page.evaluate(() => { window.loopTestSource = null; });
    await region.click();
    await page.waitForFunction(() => window.loopTestSource?.loop);
    const audio = await page.evaluate(() => {
      const source = window.loopTestSource;
      return { start: source.loopStart, end: source.loopEnd, duration: source.buffer.duration, channels: source.buffer.numberOfChannels, running: source.context.state };
    });
    assert.ok(audio.start >= 0 && audio.end <= audio.duration && audio.end - audio.start <= 20);
    assert.equal(audio.running, 'running');
    if (i) assert.ok(audio.start >= results[i - 1].end, 'Loop regions must not overlap');
    results.push({ title, ...audio });
  }
  await page.locator('#audio-stop').click();
  await page.screenshot({ path: 'artifacts/audio/real-loop-found.png' });
  assert.deepEqual(errors, []);
  console.log('PASS real-file loop search/playback:', JSON.stringify({ count, elapsed, results }));
} finally { await app.close(); }

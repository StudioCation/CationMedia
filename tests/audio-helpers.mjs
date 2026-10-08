// Read the real playback range after selecting through the waveform UI.
export async function playbackRange(page) {
  await page.evaluate(() => {
    window.testPlaybackRange = null;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.testPlaybackRange = [this.loopStart, this.loopEnd];
      AudioBufferSourceNode.prototype.start = start;
      return start.apply(this, args);
    };
  });
  await page.locator('#audio-play').click();
  await page.waitForFunction(() => window.testPlaybackRange);
  const range = await page.evaluate(() => window.testPlaybackRange);
  await page.locator('#audio-stop').click();
  return range;
}

export async function selectRange(page, start, end, duration) {
  await page.locator('#audio-clear').click();
  const box = await page.locator('#audio-wave-area').boundingBox();
  const x = time => box.x + 52 + (box.width - 52) * time / duration;
  const y = box.y + box.height * .6;
  await page.mouse.move(x(start), y); await page.mouse.down();
  await page.mouse.move(x(end), y, { steps: 8 }); await page.mouse.up();
  return playbackRange(page);
}

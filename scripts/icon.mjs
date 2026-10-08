import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const png = await readFile(path.join(root, 'public/icon.png'));
  const source = `data:image/png;base64,${png.toString('base64')}`;
  const sizes = [16, 24, 32, 48, 64, 128, 256], images = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh;object-fit:contain}</style><img src="${source}" alt="">`);
    await page.locator('img').evaluate(image => image.decode());
    images.push(await page.screenshot({ omitBackground: true }));
  }
  const header = Buffer.alloc(6 + 16 * sizes.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => { const entry = 6 + index * 16; header[entry] = header[entry + 1] = size === 256 ? 0 : size; header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6); header.writeUInt32LE(images[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += images[index].length; });
  await writeFile(path.join(root, 'build/icon.ico'), Buffer.concat([header, ...images]));
  await writeFile(path.join(root, 'build/icon.png'), images.at(-1));
  console.log('CationMedia icon generated at 16–256 px.');
} finally { await browser.close(); }

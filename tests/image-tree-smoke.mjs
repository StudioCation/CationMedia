import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

let browser, server;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 5176, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async () => {
    const root = 'C:\\';
    const assets = 'C:\\Assets';
    const textures = 'C:\\Assets\\textures';
    const fonts = 'C:\\Assets\\fonts';
    const sessionId = 'tree-test';
    const branch = (folder, relative, entries) => ({ sessionId, root, volumeRoot: root, folder, relative, entries });
    const image = { name: 'original.png', relative: 'Assets\\textures\\original.png', directory: false, size: 123, url: '/icon.png' };
    const drive = branch(root, '', [{ name: 'Assets', relative: 'Assets', directory: true }]);
    const parent = branch(assets, 'Assets', [
      ...Array.from({ length: 35 }, (_, index) => ({ name: `folder-${index}`, relative: `Assets\\folder-${index}`, directory: true })),
      { name: 'fonts', relative: 'Assets\\fonts', directory: true },
      { name: 'textures', relative: 'Assets\\textures', directory: true }
    ]);
    const current = branch(textures, 'Assets\\textures', [image]);
    const sibling = branch(fonts, 'Assets\\fonts', []);
    const branches = new Map([['', drive], ['Assets', parent], ['Assets\\textures', current], ['Assets\\fonts', sibling]]);
    const locations = [
      { id: 'desktop', name: 'Desktop', folder: 'C:\\Users\\tester\\Desktop', kind: 'shortcut' },
      { id: 'drive:C', name: 'C:', folder: root, kind: 'drive' }
    ];
    const desktop = branch(locations[0].folder, 'Users\\tester\\Desktop', [
      { name: 'desktop.png', relative: 'Users\\tester\\Desktop\\desktop.png', directory: false, size: 10, url: '/icon.png' }
    ]);
    branches.set(desktop.relative, desktop);
    window.__imageContextAction = null;
    window.__copiedImageName = null;
    window.desktop = {
      imageLocations: async () => locations,
      imageTreeContext: async (_id, relative) => ({ browser: branches.get(relative), branches: [drive, parent, branches.get(relative)].filter(Boolean) }),
      imageTreeLocation: async id => id === 'drive:C' ? drive : desktop,
      imageTreeBranch: async (_id, relative) => branches.get(relative),
      imageBrowse: async (_id, relative) => branches.get(relative),
      imageOpenLocation: async id => id === 'drive:C' ? drive : desktop,
      imageContextMenu: async () => window.__imageContextAction,
      imageCopyName: async (_id, relative) => { window.__copiedImageName = relative.split(/[\\/]/).at(-1); return window.__copiedImageName; },
      imageRename: async (_id, relative, name) => {
        if (relative === 'Assets\\fonts') {
          const entry = parent.entries.find(item => item.relative === relative);
          entry.name = name; entry.relative = 'Assets\\' + name;
          branches.delete(relative);
          branches.set(entry.relative, branch(assets + '\\' + name, entry.relative, []));
          return { name, directory: true, oldRelative: relative, newRelative: entry.relative,
            oldFolder: fonts, newFolder: assets + '\\' + name, browser: current };
        }
        const entry = current.entries.find(item => item.relative === relative);
        const oldRelative = entry.relative;
        entry.name = name; entry.relative = relative.replace(/[^\\/]+$/, name);
        return { name, directory: false, oldRelative, newRelative: entry.relative, browser: current,
          document: { name, relative: entry.relative, sessionId, browser: current } };
      }
    };
    const host = document.createElement('div');
    host.dataset.testImageTree = 'true';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#19191d';
    document.body.append(host);
    const { ImageWorkspace } = await import('/src/components/ImageWorkspace.mjs');
    const workspace = new ImageWorkspace(host);
    workspace.install({
      descriptor: { name: 'original.png', documentId: 'tree-document', relative: image.relative, sessionId, browser: current, preferredMode: 'editor' },
      sourceURL: '/icon.png',
      pixels: { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) }
    });
    window.__imageTreeWorkspace = workspace;
  });
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'textures');
  const panel = page.locator('[data-test-image-tree]');
  const content = panel.locator('[data-role="browser-scroll"]');
  const tree = panel.locator('[data-role="browser-tree"]');
  const assertFileIndent = async () => {
    const layout = await tree.evaluate(element => {
      const folder = element.querySelector('.image-tree-line.is-current .image-tree-folder').getBoundingClientRect();
      const file = element.querySelector('.image-file-row').getBoundingClientRect();
      return { folderLeft: folder.left, fileLeft: file.left, fileRight: file.right, treeRight: element.getBoundingClientRect().right };
    });
    assert.ok(layout.fileLeft > layout.folderLeft, `Files should be indented inside their folder: ${JSON.stringify(layout)}`);
    assert.ok(layout.fileRight <= layout.treeRight, `Indented files should fit the tree: ${JSON.stringify(layout)}`);
    return layout.fileLeft;
  };
  assert.equal(await tree.getByRole('button', { name: 'This PC', exact: true }).count(), 1);
  for (const name of ['Assets', 'fonts', 'textures']) assert.equal(await tree.locator('.image-tree-item').filter({ hasText: name }).count(), 1);
  assert.equal(await panel.locator('.image-file-row').count(), 1);
  assert.equal(await panel.locator('.image-browser-head, .image-browser-breadcrumb, .image-tree-row').count(), 0);
  assert.equal(await panel.locator('.image-browser-splitter').count(), 0);
  assert.equal(await content.evaluate(element => element.contains(document.querySelector('[data-test-image-tree] [data-role="browser-tree"]')) && element.contains(document.querySelector('[data-test-image-tree] [data-role="browser-list"]'))), true);
  assert.equal(await tree.evaluate(element => element.querySelector('.image-tree-line.is-current')?.nextElementSibling === element.querySelector('[data-role="browser-list"]')), true);
  assert.equal(await content.evaluate(element => {
    const content = element.getBoundingClientRect();
    const image = element.querySelector('.image-file-row').getBoundingClientRect();
    return image.top >= content.top && image.top < content.bottom;
  }), true);
  assert.equal(await panel.locator('.image-browser-tools').evaluate(element => element.getBoundingClientRect().bottom <= document.querySelector('[data-test-image-tree] [data-role="browser-scroll"]').getBoundingClientRect().top), true);
  assert.equal(await tree.getByRole('button', { name: 'Collapse textures' }).count(), 1);
  const nestedFileLeft = await assertFileIndent();
  const openFolderIcon = await tree.locator('.image-tree-item').filter({ hasText: 'Assets' }).locator('.image-tree-folder svg').first().evaluate(svg => svg.innerHTML);
  const closedFolderIcon = await tree.locator('.image-tree-item').filter({ hasText: 'fonts' }).locator('.image-tree-folder svg').first().evaluate(svg => svg.innerHTML);
  assert.notEqual(openFolderIcon, closedFolderIcon, 'Expanded and collapsed folders should have different icons.');
  await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).click();
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-expand[aria-label="Expand textures"]'));
  assert.equal(await panel.locator('.image-file-row').isVisible(), false);
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).locator('.image-tree-folder svg').evaluate(svg => svg.innerHTML), closedFolderIcon);
  await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).click();
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-expand[aria-label="Collapse textures"]'));
  assert.equal(await panel.locator('.image-file-row').isVisible(), true);
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).locator('.image-tree-folder svg').evaluate(svg => svg.innerHTML), openFolderIcon);
  await panel.locator('[data-image-action="view"]').click();
  await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).click();
  assert.equal(await panel.locator('.image-file-row').isVisible(), false);
  await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).click();
  assert.equal(await panel.locator('.image-file-row').isVisible(), true);
  await assertFileIndent();
  await panel.locator('[data-image-action="view"]').click();
  await tree.locator('.image-tree-expand[data-tree-expand="desktop-root"]').click();
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'Assets' }).count(), 0);
  await tree.locator('.image-tree-expand[data-tree-expand="desktop-root"]').click();
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'Assets' }).count(), 1);

  await tree.locator('.image-tree-item').filter({ hasText: 'Assets' }).click();
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'Assets');
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).count(), 0);
  await tree.locator('.image-tree-item').filter({ hasText: 'Assets' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-test-image-tree] .image-tree-item')].some(item => item.textContent.trim() === 'textures'));
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).count(), 1);

  await tree.locator('.image-tree-item').filter({ hasText: 'fonts' }).click();
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'fonts');
  assert.equal(await panel.locator('.image-file-row').count(), 0);
  assert.equal(await tree.evaluate(element => element.querySelector('.image-tree-line.is-current')?.nextElementSibling === element.querySelector('[data-role="browser-list"]')), true);
  const emptyFolderGap = await tree.evaluate(element => {
    const selected = element.querySelector('.image-tree-line.is-current');
    const nextFolder = selected.nextElementSibling?.nextElementSibling;
    return nextFolder.getBoundingClientRect().top - selected.getBoundingClientRect().bottom;
  });
  assert.ok(emptyFolderGap <= 32, `Empty folder created a ${emptyFolderGap}px gap in the tree.`);
  if (process.env.IMAGE_TREE_SCREENSHOT) await page.screenshot({ path: process.env.IMAGE_TREE_SCREENSHOT });
  await tree.locator('.image-tree-item').filter({ hasText: 'textures' }).click();
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'textures');
  assert.equal(await panel.locator('.image-file-row').count(), 1);

  await page.evaluate(() => { window.__imageContextAction = 'copy-name'; });
  await tree.locator('.image-tree-item').filter({ hasText: 'fonts' }).click({ button: 'right' });
  await page.waitForFunction(() => window.__copiedImageName === 'fonts');
  await page.evaluate(() => { window.__imageContextAction = 'rename-entry'; });
  await tree.locator('.image-tree-item').filter({ hasText: 'fonts' }).click({ button: 'right' });
  assert.equal(await tree.locator('.image-tree-item').filter({ hasText: 'fonts' }).isVisible(), false);
  await panel.locator('.image-entry-rename').fill('labels');
  await panel.locator('.image-entry-rename').press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-test-image-tree] .image-tree-item')].some(item => item.textContent.trim() === 'labels'));
  assert.equal(await panel.locator('.image-file-row').count(), 1);

  await page.evaluate(() => { window.__imageContextAction = 'copy-name'; });
  await panel.locator('.image-file-row').click({ button: 'right' });
  await page.waitForFunction(() => window.__copiedImageName === 'original.png');
  await page.evaluate(() => { window.__imageContextAction = 'rename-entry'; });
  await panel.locator('.image-file-row').click({ button: 'right' });
  const rename = panel.locator('.image-entry-rename');
  assert.equal(await panel.locator('.image-file-open').isVisible(), false);
  await rename.fill('renamed.png');
  await rename.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-file-details strong')?.textContent === 'renamed.png');
  assert.equal(await page.evaluate(() => window.__imageTreeWorkspace.name), 'renamed.png');

  await content.evaluate(element => { element.scrollTop = 0; });
  await tree.locator('.image-tree-item').filter({ hasText: 'Assets' }).hover();
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] [data-role="browser-scroll"]').scrollTop > 0);
  await panel.locator('.image-file-row').hover();
  const before = await content.evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, -200);
  await page.waitForFunction(previous => document.querySelector('[data-test-image-tree] [data-role="browser-scroll"]').scrollTop < previous, before);
  const toolList = panel.locator('.image-tool-list');
  await toolList.evaluate(element => { element.scrollTop = 0; });
  await toolList.hover();
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tool-list').scrollTop > 0);
  await page.evaluate(() => {
    const history = document.querySelector('[data-test-image-tree] .image-history-list');
    for (let index = 0; index < 24; index++) {
      const item = document.createElement('li');
      const row = document.createElement('button'); row.className = 'image-history-row'; row.textContent = `Step ${index}`;
      item.append(row); history.append(item);
    }
  });
  const history = panel.locator('.image-history-list');
  await history.hover();
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-history-list').scrollTop > 0);
  const ribbonScroll = await page.evaluate(() => {
    const workspace = window.__imageTreeWorkspace;
    workspace.documentBrowser.entries = Array.from({ length: 24 }, (_, index) => ({ name: `image-${index}.png`, relative: `Assets\\textures\\image-${index}.png`, directory: false, url: '/icon.png' }));
    workspace.renderRibbon();
    const ribbon = workspace.q('ribbon-list');
    workspace.el.querySelector('.image-ribbon').style.display = 'block';
    ribbon.style.width = '500px';
    ribbon.dispatchEvent(new WheelEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true }));
    return ribbon.scrollLeft;
  });
  assert.ok(ribbonScroll > 0);
  await tree.locator('.image-tree-item[data-image-location="desktop"]').click();
  await page.waitForFunction(() => document.querySelector('[data-test-image-tree] .image-tree-line.is-current .image-tree-item')?.textContent.trim() === 'Desktop');
  assert.equal(await panel.locator('.image-file-details strong').textContent(), 'desktop.png');
  const desktopFileLeft = await assertFileIndent();
  assert.ok(desktopFileLeft < nestedFileLeft, 'File indentation should decrease when switching to a shallower folder.');
  const aliasRows = await page.evaluate(() => {
    const workspace = window.__imageTreeWorkspace;
    workspace.locations.push({ id: 'assets-shortcut', name: 'Assets shortcut', folder: 'C:\\Assets', kind: 'shortcut' });
    workspace.treeExpanded.add('shortcut:assets-shortcut');
    workspace.treeExpanded.add('path:' + workspace.treeKey('C:\\Assets'));
    workspace.renderTree();
    const before = [...workspace.q('browser-tree').querySelectorAll('[data-entry-name="textures"]')];
    workspace.renderTree();
    const after = [...workspace.q('browser-tree').querySelectorAll('[data-entry-name="textures"]')];
    return { count: after.length, retained: before.every((row, index) => row === after[index]) };
  });
  assert.deepEqual(aliasRows, { count: 2, retained: true }, 'Shortcut and drive branches must retain separate DOM rows for the same folder.');
  console.log('PASS: images beside selected folder and wheel scrolling in files, tools, history, and ribbon.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}

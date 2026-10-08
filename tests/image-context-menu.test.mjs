import test from 'node:test';
import assert from 'node:assert/strict';
import { imageContextMenuTemplate } from '../shared/imageContextMenu.mjs';
import { imageExportFormats } from '../shared/image.mjs';
import { mediaMenuTemplate } from '../shared/mediaMenu.mjs';

const command = (label, action) => ({ label, action });
const byAction = (items, action) => items.find(item => item.action === action);

test('image stage menu offers format conversion and gates editing in viewer mode', () => {
  const menu = imageContextMenuTemplate({ context: 'stage', mode: 'viewer', hasImage: true, hasBrowser: true }, command);
  assert.equal(byAction(menu, 'mode:editor').enabled, true);
  assert.equal(menu.find(item => item.label === 'Tools').enabled, false);
  assert.equal(byAction(menu, 'apply'), undefined);
  assert.equal(byAction(menu, 'undo').enabled, false);
  assert.deepEqual(menu.find(item => item.label === 'Convert to…').submenu.map(item => item.action), imageExportFormats.map(format => `convert:${format}`));
  assert.equal(menu.find(item => item.label === 'Convert to…').submenu.some(item => item.type === 'radio'), false);
  assert.equal(byAction(menu, 'save').enabled, true);
  assert.equal(byAction(menu, 'save-as').enabled, true);
});

test('image stage menu selects a tool and reflects history availability', () => {
  const menu = imageContextMenuTemplate({ context: 'stage', mode: 'editor', hasImage: true, activeTools: ['auto-cutout'], undo: true, redo: false }, command);
  const tools = menu.find(item => item.label === 'Tools').submenu;
  assert.equal(tools.find(item => item.action === 'tool:auto-cutout').checked, true);
  assert.ok(byAction(tools, 'tool:alpha-mask'));
  assert.ok(byAction(tools, 'tool:atlas'));
  assert.ok(byAction(tools, 'tool:loop-texture'));
  assert.equal(byAction(tools, 'tool:reset'), undefined);
  assert.equal(byAction(menu, 'reset').enabled, true);
  assert.equal(byAction(menu, 'build-atlas'), undefined);
  assert.equal(byAction(menu, 'apply'), undefined);
  assert.equal(byAction(menu, 'undo').enabled, true);
  assert.equal(byAction(menu, 'redo').enabled, false);
  assert.deepEqual(tools.map(item => item.label), [...tools.map(item => item.label)].sort((a, b) => a.localeCompare(b, 'en')));
});

test('image menus expose one angle rotation tool', () => {
  const tools = imageContextMenuTemplate({ context: 'stage', mode: 'editor', hasImage: true }, command)
    .find(item => item.label === 'Tools').submenu;
  const rotateTools = tools.filter(item => item.label.startsWith('Rotate'));
  assert.deepEqual(rotateTools.map(item => [item.label, item.action]), [['Rotate…', 'tool:rotate']]);
  const edit = mediaMenuTemplate('image', command).find(item => item.label === 'Edit').submenu;
  assert.deepEqual(edit.filter(item => item.label.startsWith('Rotate')).map(item => [item.label, item.action.action]), [['Rotate…', 'rotate']]);
});

test('image File menu keeps Save as and exposes explicit conversion formats', () => {
  const file = mediaMenuTemplate('image', command).find(item => item.label === 'File').submenu;
  assert.ok(file.some(item => item.label === 'Save image as…' && item.action.action === 'save-as'));
  assert.deepEqual(file.find(item => item.label === 'Convert image to…').submenu.map(item => item.action.action), imageExportFormats.map(format => `convert:${format}`));
  const atlas = imageContextMenuTemplate({ context: 'stage', mode: 'editor', hasImage: true, atlasReady: true }, command);
  assert.deepEqual(atlas.find(item => item.label === 'Save atlas as…').submenu.map(item => item.action), ['save-atlas:png', 'save-atlas:webp']);
});

test('file context offers open and atlas selection without edit commands', () => {
  const menu = imageContextMenuTemplate({ context: 'file', hasBrowser: true, canUp: true, entry: { name: 'photo.png', selected: true, renamable: true } }, command);
  assert.equal(byAction(menu, 'open-entry').enabled, true);
  assert.equal(byAction(menu, 'select-entry').checked, true);
  assert.equal(byAction(menu, 'copy-name').enabled, true);
  assert.equal(byAction(menu, 'rename-entry').enabled, true);
  assert.equal(byAction(menu, 'up').enabled, true);
  assert.equal(byAction(menu, 'locations').enabled, true);
  assert.equal(byAction(menu, 'undo'), undefined);
  const folder = imageContextMenuTemplate({ context: 'file', hasBrowser: true, entry: { directory: true, renamable: true } }, command);
  assert.equal(byAction(folder, 'select-entry'), undefined);
  assert.equal(byAction(folder, 'open-entry').label, 'Open folder');
  assert.equal(byAction(folder, 'rename-entry').enabled, true);
  const drive = imageContextMenuTemplate({ context: 'file', hasBrowser: true, entry: { directory: true, renamable: false } }, command);
  assert.equal(byAction(drive, 'rename-entry').enabled, false);
  const browser = imageContextMenuTemplate({ context: 'browser', hasBrowser: true, canUp: true }, command);
  assert.equal(byAction(browser, 'locations').enabled, true);
});

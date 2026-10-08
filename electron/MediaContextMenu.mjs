import { Menu } from 'electron';
import { meshContextMenu } from './MeshContextMenu.mjs';
import { audioFormats } from '../shared/mediaTypes.mjs';

import { videoContextMenuTemplate } from '../shared/videoContextMenu.mjs';
import { imageContextMenuTemplate } from '../shared/imageContextMenu.mjs';

const menus = new WeakMap();
export function imageContextMenu(window, state) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = action => { if (!settled) { settled = true; resolve(action); } };
    const command = (label, action) => ({ label, click: () => finish(action) });
    try {
      const menu = Menu.buildFromTemplate(imageContextMenuTemplate(state, command));
      menu.popup({ window, callback: () => setTimeout(() => finish(null), 0) });
    } catch (error) { reject(error); }
  });
}

export function mediaContextMenu(window, state) {
  if (state?.mediaType === 'video') {
    const command = (label, action) => ({ label, click: () => window.webContents.send('app:command', { type: 'video', action }) });
    const menu = Menu.buildFromTemplate(videoContextMenuTemplate(state, command));
    menu.popup({ window }); return;
  }
  if (state?.mediaType === 'model3d') return meshContextMenu(window, state);
  if (state?.mediaType !== 'audio') return;
  if (state.loopRegion) {
    Menu.buildFromTemplate([{ label: 'Save As…', click: () => window.webContents.send('app:command', { type: 'audio', action: 'export-loop' }) }]).popup({ window });
    return;
  }
  if (state.timeline) {
    const command = (label, action, enabled = true) => ({ label, enabled, click: () => window.webContents.send('app:command', { type: 'audio', action: `timeline:${action}` }) });
    Menu.buildFromTemplate([command('Duplicate clip', 'duplicate', Boolean(state.clip && state.canAdd)), command('Split at playhead (Ctrl+Shift+D)', 'split', Boolean(state.clip && state.canAdd)), { type: 'separator' }, command('Delete layer', 'remove')]).popup({ window }); return;
  }
  let menu = menus.get(window);
  if (!menu) {
    const command = (label, action, extra = {}) => ({ label, id: action, ...extra, click: () => window.webContents.send('app:command', { type: 'audio', action }) });
    menu = Menu.buildFromTemplate([
      command('Play / Pause', 'play'), command('Stop', 'stop'), command('Loop', 'loop', { type: 'checkbox' }), { type: 'separator' },
      command('Set In', 'in'), command('Set Out', 'out'), command('Select All', 'all'), command('Clear Selection', 'clear'),
      { type: 'separator' }, command('Trim to Selection', 'trim'), command('Delete Selection', 'delete'), command('Reverse', 'reverse'),
      { label: 'Effects', submenu: [command('Fade In', 'fade-in'), command('Fade Out', 'fade-out'), command('Pitch…', 'effect:pitch'), command('Volume…', 'effect:gain'), command('Time Stretch…', 'effect:stretch'), command('Chorus', 'chorus'), command('Distortion…', 'effect:distortion'), command('Smoothness…', 'effect:smooth')] },
      command('Find Loop Regions', 'find-loops'), { type: 'separator' },
      { label: 'Convert To…', submenu: audioFormats.map(format => command(format.toUpperCase(), `export:${format}`)) },
      command('Save As…', 'export'), { type: 'separator' }, command('Undo', 'undo'), command('Redo', 'redo')
    ]);
    menus.set(window, menu);
  }
  for (const id of ['trim', 'delete', 'clear']) menu.getMenuItemById(id).enabled = Boolean(state.selected);
  for (const id of ['undo', 'redo']) menu.getMenuItemById(id).enabled = Boolean(state[id]);
  menu.getMenuItemById('loop').checked = Boolean(state.loop);
  menu.popup({ window });
}

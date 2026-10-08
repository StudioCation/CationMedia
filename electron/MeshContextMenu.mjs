import { Menu } from 'electron';
import { hasCapability, modelFormats, textureFormats } from '../shared/mediaTypes.mjs';
const menus = new WeakMap();
export function meshContextMenu(window, state) {
  if (!hasCapability(state?.mediaType, 'scene')) return;
  const selected = Boolean(state?.selected);
  const send = action => window.webContents.send('app:command', { ...action, selected });
  const textures = Array.isArray(state.textures) ? state.textures.filter(item => typeof item.id === 'string' && typeof item.name === 'string').slice(0, 2048) : [];
  const meshCount = Number.isInteger(state.meshCount) ? state.meshCount : 0;
  const sourceTextureCount = Number.isInteger(state.sourceTextureCount) ? state.sourceTextureCount : 0;
  const signature = JSON.stringify([selected, textures, meshCount, sourceTextureCount]);
  const cached = menus.get(window);
  if (cached?.signature === signature) {
    for (const mode of ['smooth', 'auto', 'flat']) cached.menu.getMenuItemById(mode).checked = state.mode === mode;
    cached.menu.getMenuItemById('original').enabled = state.mode !== 'original';
    cached.menu.popup({ window }); return;
  }
  const convert = modelFormats.map(([format, label]) => ({ label, click: () => send({ type: 'export', format }) }));
  if (!selected && meshCount > 1) convert.push({ type: 'separator' }, {
    label: `Each mesh separately (${meshCount})`,
    submenu: modelFormats.map(([format, label]) => ({ label, click: () => send({ type: 'export-meshes', format }) }))
  });
  if (sourceTextureCount > 0) convert.push({ type: 'separator' }, {
    label: 'Save original texture bytes…', click: () => send({ type: 'source-textures' })
  });
  if (hasCapability(state.mediaType, 'textureExport') && textures.length) {
    convert.push({ type: 'separator' }, { label: 'All textures (' + textures.length + ')', submenu: textureFormats.map(format => ({ label: format.toUpperCase(), click: () => send({ type: 'mesh-textures', format }) })) },
      ...textures.map(item => ({ label: item.name.replace(/&/g, '&&'), submenu: textureFormats.map(format => ({ label: format.toUpperCase(), click: () => send({ type: 'mesh-texture', textureId: item.id, format }) })) })));
  }
  const menu = Menu.buildFromTemplate([
    ...[['smooth', 'Shade Smooth'], ['auto', 'Shade Auto Smooth (30°)'], ['flat', 'Shade Flat']].map(([mode, label]) => ({ id: mode, label, type: 'checkbox', checked: state.mode === mode, click: () => send({ type: 'shade', mode }) })),
    { type: 'separator' }, { label: 'Convert To…', submenu: convert }, { type: 'separator' },
    { id: 'original', label: 'Restore Imported Shading', enabled: state.mode !== 'original', click: () => send({ type: 'shade', mode: 'original' }) }
  ]);
  menus.set(window, { signature, menu });
  menu.popup({ window });
}

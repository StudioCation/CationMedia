import { app, Menu } from 'electron';
import { mediaMenuTemplate } from '../shared/mediaMenu.mjs';
export function installMenu(window) {
  let currentType;
  const command = (label, action, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => window.webContents.send('app:command', action) });
  return state => {
    const id = state.mediaType || null;
    if (currentType === id) return;
    currentType = id;
    Menu.setApplicationMenu(Menu.buildFromTemplate(mediaMenuTemplate(id, command, app.getVersion())));
  };
}

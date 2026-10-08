import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, net, shell, nativeImage } from 'electron';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { BlenderManager } from './BlenderManager.mjs';
import { extensions, supported, resolveAsset } from './files.mjs';
import { nearbyTextures, nearbySidecar, sidecarTextureFiles, isTexture } from './textureFiles.mjs';
import { installMenu } from './NativeMenu.mjs';
import { saveExport, saveModelBatch, saveSourceTextureBatch, saveTextureBatch } from './ExportService.mjs';
import { imageContextMenu, mediaContextMenu } from './MediaContextMenu.mjs';
import { discoverTextures } from './TextureDiscovery.mjs';
import { detectMediaType, mediaTypes } from '../shared/mediaTypes.mjs';
import { saveAudio } from './AudioExportService.mjs';
import { AudioCodec } from './AudioCodec.mjs';
import { VideoCodec } from './VideoCodec.mjs';
import { videoOptions } from '../shared/video.mjs';
import { videoResponse } from './videoResponse.mjs';
import { ImageFileService } from './ImageFileService.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Preserve the existing viewer profile while changing the public product name.
if (!process.argv.some(arg => arg.startsWith('--user-data-dir'))) app.setPath('userData', path.join(app.getPath('appData'), 'cation-viewer-3d'));
protocol.registerSchemesAsPrivileged([{ scheme: 'model', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window, rendererReady = false, pending = process.argv.find(supported), settings = {}, blender, audioDirty = false, imageDirty = false, closePrompt = false, images;
const grants = new Map();
const offers = new Map();
const audioDocuments = new Map();
const audio = new AudioCodec(app.isPackaged ? path.join(process.resourcesPath, 'audio/ffmpeg.exe') : path.join(here, '../node_modules/ffmpeg-static/ffmpeg.exe'));
const video = new VideoCodec(audio.executable), videoDocuments = new Map();
function videoURL(file) { const token = randomUUID(); grants.set(token, { root: path.dirname(file), allowed: new Set([file]) }); return `model://${token}/${encodeURIComponent(path.basename(file))}`; }
async function importAudio(file) {
  file = await realpath(file);
  if (!['audio', 'video'].includes(detectMediaType(file)?.id)) throw new Error('Select audio or video.');
  return { name: path.basename(file), data: await audio.decode(file) };
}
async function open(file) {
  if (!supported(file)) throw new Error('This file format is not supported.');
  file = await realpath(file);
  if (!(await stat(file)).isFile()) throw new Error('Select a model file.');
  const source = file;
  if (detectMediaType(file)?.id === 'image') return images.open(file);
  if (detectMediaType(file)?.id === 'video') {
    const info = await video.probe(file), documentId = randomUUID();
    videoDocuments.set(documentId, { file, info });
    return { name: path.basename(file), mediaType: 'video', documentId, info, url: videoURL(file) };
  }
  if (detectMediaType(file)?.id === 'audio') {
    offers.clear();
    const data = await audio.decode(file), documentId = randomUUID();
    audioDocuments.set(documentId, file);
    return { name: path.basename(file), mediaType: 'audio', data, documentId, extension: path.extname(file).slice(1).toLowerCase() };
  }
  if (path.extname(file).toLowerCase() === '.blend') file = await blender.convert(file, settings.blender);
  const token = randomUUID();
  grants.set(token, path.dirname(file));
  // Keep a small window for in-flight loads while bounding capabilities.
  if (grants.size > 8) grants.delete(grants.keys().next().value);
  const baseURL = `model://${token}/`;
  const assets = await nearbyTextures(path.dirname(file), baseURL);
  const sidecars = await nearbySidecar(file, baseURL);
  assets.push(...sidecars);
  if (path.dirname(source) !== path.dirname(file)) {
    const sourceToken = randomUUID();
    grants.set(sourceToken, path.dirname(source));
    assets.push(...await nearbyTextures(path.dirname(source), `model://${sourceToken}/`));
  }
  while (grants.size > 8) grants.delete(grants.keys().next().value);
  const known = assets.filter(asset => asset.url.startsWith(baseURL)).map(asset => path.join(path.dirname(file), decodeURIComponent(new URL(asset.url).pathname.slice(1))));
  const discovery = await discoverTextures(source, known);
  const referenced = await sidecarTextureFiles(file, sidecars, assets, discovery.files);
  if (referenced.length) {
    const textureToken = randomUUID();
    grants.set(textureToken, { root: discovery.root, allowed: new Set(referenced.map(asset => asset.absolute)) });
    assets.push(...referenced.map(asset => ({ name: asset.name, url: `model://${textureToken}/${asset.relative.split(path.sep).map(encodeURIComponent).join('/')}` })));
    discovery.files = discovery.files.filter(asset => !referenced.includes(asset));
    while (grants.size > 8) grants.delete(grants.keys().next().value);
  }
  offers.clear();
  let textureOffer = null;
  if (discovery.files.length) {
    const id = randomUUID(); offers.set(id, { ...discovery, modelToken: token });
    textureOffer = { id, count: discovery.files.length, folders: [...new Set(discovery.files.map(item => path.dirname(item.relative)))] };
  }
  return { name: path.basename(source), mediaType: detectMediaType(source)?.id, url: `${baseURL}${encodeURIComponent(path.basename(file))}`, extension: path.extname(file).slice(1).toLowerCase(), assets, textureOffer };
}
async function deliver(file) { if (!rendererReady) { pending = file; return; } window.webContents.send('model:file', { pathPending: true }); try { window.webContents.send('model:file', { ...await open(file), autoplay: true }); } catch (error) { window.webContents.send('model:file', { error: error.message }); } }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_, argv) => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); const file = argv.find(supported); if (file) void deliver(file); } });
  app.on('open-file', (event, file) => { event.preventDefault(); void deliver(file); });
  app.whenReady().then(async () => {
  const config = path.join(app.getPath('userData'), 'settings.json');
  settings = await readFile(config, 'utf8').then(JSON.parse).catch(() => ({}));
  blender = new BlenderManager(app.isPackaged ? path.join(process.resourcesPath, 'blend_export.py') : path.join(here, '../scripts/blend_export.py'));
  protocol.handle('model', async request => {
    try { const url = new URL(request.url), grant = grants.get(url.host); if (!grant) return new Response('Forbidden', { status: 403 }); const file = await resolveAsset(typeof grant === 'string' ? grant : grant.root, decodeURIComponent(url.pathname.slice(1))); if (grant.allowed && !grant.allowed.has(file)) return new Response('Forbidden', { status: 403 }); if (detectMediaType(file)?.id === 'video') return videoResponse(file, request); return net.fetch(pathToFileURL(file).href); }
    catch { return new Response('Resource unavailable', { status: 404 }); }
  });
  const handle = (name, callback) => ipcMain.handle(name, (event, ...args) => { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Forbidden'); return callback(...args); });
  handle('model:dialog', async id => { const family = mediaTypes.find(type => type.id === id); const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: family ? [{ name: family.label, extensions: family.extensions }] : [{ name: 'All supported media', extensions }, ...mediaTypes.map(type => ({ name: type.label, extensions: type.extensions }))] }); return result.canceled ? null : open(result.filePaths[0]); });
  handle('textures:accept', id => {
    const offer = offers.get(id);
    if (!offer || !grants.has(offer.modelToken)) throw new Error('This texture suggestion has expired.');
    offers.delete(id);
    const token = randomUUID(); grants.set(token, { root: offer.root, allowed: new Set(offer.files.map(file => file.absolute)) });
    while (grants.size > 8) grants.delete(grants.keys().next().value);
    return offer.files.map(file => ({ name: file.name, url: `model://${token}/${file.relative.split(path.sep).map(encodeURIComponent).join('/')}` }));
  });
  handle('model:open', open);
  handle('model:ready', () => { rendererReady = true; if (pending) { const file = pending; pending = null; void deliver(file); } });
  handle('blender:select', async () => { const result = await dialog.showOpenDialog(window, { title: 'Select blender.exe', filters: [{ name: 'Blender', extensions: ['exe'] }] }); if (result.canceled) return null; if (path.basename(result.filePaths[0]).toLowerCase() !== 'blender.exe') throw new Error('Select blender.exe'); settings.blender = result.filePaths[0]; await writeFile(config, JSON.stringify(settings)); return settings.blender; });
  handle('windows:defaults', () => shell.openExternal('ms-settings:defaultapps'));
  const confirmDiscard = async () => (await dialog.showMessageBox(window, { type: 'question', title: 'Unsaved changes', message: 'Save changes to the audio file?', detail: 'Save changes: save the current audio file (choose a new file if its format cannot be written).\nDo not save changes: continue without keeping your edits.', buttons: ['Save changes', 'Do not save changes', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true })).response;
  handle('audio:discard', confirmDiscard);
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 620, backgroundColor: '#18181c', title: 'CationMedia', icon: path.join(here, '../build/icon.ico'), webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
  images = new ImageFileService({ app, window, dialog, grants, ffmpeg: audio.executable });
  const updateMenu = installMenu(window);
  handle('app:state', state => { audioDirty = Boolean(state?.mediaType === 'audio' && state?.audioDirty); imageDirty = Boolean(state?.mediaType === 'image' && state?.imageDirty); updateMenu(state || {}); });
  handle('image:browse', (id, relative) => images.browse(id, relative));
  handle('image:locations', () => images.locations());
  handle('image:tree-context', (id, relative) => images.treeContext(id, relative));
  handle('image:tree-location', id => images.treeLocation(id));
  handle('image:tree-branch', (id, relative) => images.folderBranch(id, relative));
  handle('image:open-location', id => images.openLocation(id));
  handle('image:ancestor', (id, relative, levels) => images.ancestor(id, relative, levels));
  handle('image:choose-folder', () => images.chooseFolder());
  handle('image:open-entry', (id, relative) => images.openEntry(id, relative));
  handle('image:copy-name', async (id, relative) => { const name = await images.entryName(id, relative); clipboard.writeText(name); return name; });
  handle('image:rename', (id, relative, name, context) => images.renameEntry(id, relative, name, context));
  ipcMain.on('image:start-drag', async (event, id, relative, relatives) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    try {
      const file = images.dragPath(id, relative);
      const files = images.dragPaths(id, relatives ?? [relative]);
      if (!files.includes(file)) throw new Error('The dragged image must be selected.');
      let icon = nativeImage.createFromPath(file);
      if (icon.isEmpty()) icon = nativeImage.createFromBuffer(await images.dragThumbnail(id, relative));
      if (icon.isEmpty()) throw new Error('Image preview is unavailable.');
      const { width, height } = icon.getSize();
      const scale = Math.min(1, 160 / width, 160 / height);
      if (scale < 1) icon = icon.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
      event.sender.startDrag({ file, ...(files.length > 1 ? { files } : {}), icon });
    } catch {
      event.sender.send('image:drag-error', 'These images cannot be dragged from the current folder.');
    }
  });
  handle('image:read', (id, relative) => images.read(id, relative));
  handle('image:decode', (id, relative, thumbnail) => images.decode(id, relative, thumbnail));
  handle('image:save', (id, payload) => images.save(id, payload));
  handle('image:save-changes', (id, payload) => images.saveChanges(id, payload));
  handle('image:save-atlas', (id, payload) => images.saveAtlas(id, payload));
  const confirmImageDiscard = async () => (await dialog.showMessageBox(window, { type: 'question', title: 'Unsaved image edits', message: 'Save image edits before continuing?', detail: 'Save writes changes to the current image.', buttons: ['Save', 'Discard edits', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true })).response;
  handle('image:discard', confirmImageDiscard);
  handle('image:fullscreen', fullscreen => {
    if (typeof fullscreen !== 'boolean') throw new Error('Invalid fullscreen state.');
    if (window.isFullScreen() !== fullscreen) window.setFullScreen(fullscreen);
    window.setMenuBarVisibility(!fullscreen);
    return window.isFullScreen();
  });
  window.on('enter-full-screen', () => { window.setMenuBarVisibility(false); window.webContents.send('image:fullscreen', true); });
  window.on('leave-full-screen', () => { window.setMenuBarVisibility(true); window.webContents.send('image:fullscreen', false); });
  window.on('close', event => {
    if (!audioDirty && !imageDirty) return;
    event.preventDefault();
    if (closePrompt) return;
    closePrompt = true;
    void (audioDirty ? confirmDiscard() : confirmImageDiscard()).then(choice => {
      if (choice === 0) { window.webContents.send('app:command', { type: audioDirty ? 'save-before-close' : 'image-save-before-close' }); return; }
      closePrompt = false;
      if (choice === 1) { audioDirty = false; imageDirty = false; window.close(); }
    }).catch(() => { closePrompt = false; });
  });
  handle('audio:close-saved', saved => {
    if (!closePrompt) return;
    closePrompt = false;
    if (saved === true) { audioDirty = false; window.close(); }
  });
  handle('media:context', state => mediaContextMenu(window, state));
  handle('image:context', state => imageContextMenu(window, state));
  handle('export:save', payload => saveExport(window, payload, { blender, blenderPath: settings.blender }));
  handle('export:meshes', payload => saveModelBatch(window, payload, { blender, blenderPath: settings.blender }));
  handle('export:source-textures', payload => saveSourceTextureBatch(window, payload));
  handle('export:textures', payload => saveTextureBatch(window, payload));
  let audioQueue = Promise.resolve();
  const audioJob = callback => { const job = audioQueue.catch(() => {}).then(callback); audioQueue = job; return job; };
  handle('audio:process', payload => audioJob(() => audio.process(payload)));
  handle('audio:import-file', file => audioJob(() => importAudio(file)));
  handle('audio:import', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio / Video', extensions: mediaTypes.filter(t => ['audio', 'video'].includes(t.id)).flatMap(t => t.extensions) }] });
    if (result.canceled) return [];
    return audioJob(async () => { const results = []; for (const file of result.filePaths) results.push(await importAudio(file)); return results; });
  });
  handle('image:close-saved', saved => {
    if (!closePrompt) return;
    closePrompt = false;
    if (saved === true) { imageDirty = false; window.close(); }
  });
  handle('video:preview', async id => { const doc = videoDocuments.get(id); if (!doc) throw new Error('Video document expired.'); doc.preview ||= video.preview(doc.file, doc.info).catch(error => { doc.preview = null; throw error; }); return videoURL(await doc.preview); });
  handle('video:audio', async payload => {
    const doc = videoDocuments.get(payload?.documentId); if (!doc) throw new Error('Video document expired.');
    if (!doc.info.hasAudio) throw new Error('This video has no audio track.');
    const encoding = audio.exportOptions(payload);
    if (![1, 2].includes(payload.channels)) throw new Error('Invalid channel count.');
    const result = await dialog.showSaveDialog(window, { defaultPath: path.join(path.dirname(doc.file), `${path.parse(doc.file).name}-audio.${payload.format}`), filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }] });
    if (result.canceled || !result.filePath) return null;
    const destination = path.extname(result.filePath).toLowerCase() === `.${payload.format}` ? result.filePath : `${result.filePath}.${payload.format}`;
    if (destination.toLowerCase() === doc.file.toLowerCase()) throw new Error('Choose a new file to preserve the source.');
    await video.extractAudio(doc.file, destination, payload.format, [...encoding, '-ac', String(payload.channels)]);
    return { name: path.basename(destination), size: (await stat(destination)).size };
  });
  handle('video:frame', async payload => {
    const doc = videoDocuments.get(payload?.documentId); if (!doc) throw new Error('Video document expired.');
    const options = videoOptions(payload.options, doc.info);
    if (!Number.isFinite(payload.time) || payload.time < 0 || payload.time > doc.info.duration) throw new Error('Invalid frame time.');
    const result = await dialog.showSaveDialog(window, { defaultPath: path.join(path.dirname(doc.file), `${path.parse(doc.file).name}-frame.png`), filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return null;
    const destination = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`;
    await video.frame(doc.file, destination, payload.time, options, doc.info);
    return { name: path.basename(destination) };
  });
  handle('video:export', async payload => {
    const doc = videoDocuments.get(payload?.documentId); if (!doc) throw new Error('Video document expired.');
    const options = videoOptions(payload.options, doc.info);
    const result = await dialog.showSaveDialog(window, { defaultPath: path.join(path.dirname(doc.file), `${path.parse(doc.file).name}-edited.${options.format}`), filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }] });
    if (result.canceled || !result.filePath) return null;
    let destination = result.filePath;
    if (path.extname(destination).toLowerCase() !== `.${options.format}`) destination += `.${options.format}`;
    if (destination.toLowerCase() === doc.file.toLowerCase()) throw new Error('Save video to a new file to preserve the open source.');
    await video.export(doc.file, destination, options, doc.info);
    return { name: path.basename(destination), size: (await stat(destination)).size };
  });
  handle('audio:export', payload => audioJob(async () => {
    return saveAudio(window, payload, { codec: audio, documents: audioDocuments, showSaveDialog: (...args) => dialog.showSaveDialog(...args), writeFile });
  }));
  handle('texture:dialog', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Select a texture to convert', properties: ['openFile'], filters: [{ name: 'Textures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'psd', 'tif', 'tiff'] }] });
    if (result.canceled) return null;
    const file = await realpath(result.filePaths[0]);
    if (!isTexture(file)) throw new Error('Select a supported texture.');
    const token = randomUUID(); grants.set(token, path.dirname(file));
    while (grants.size > 8) grants.delete(grants.keys().next().value);
    return { name: path.basename(file), url: `model://${token}/${encodeURIComponent(path.basename(file))}` };
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  const dev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL;
  if (dev) await window.loadURL(dev); else await window.loadFile(path.join(here, '../dist/index.html'));
  app.on('window-all-closed', () => app.quit());
  let cleaned = false;
  app.on('before-quit', event => {
    if (cleaned) return;
    event.preventDefault();
    if (audioDirty || imageDirty) { window.close(); return; }
    audio.dispose();
    void video.dispose();
    blender.dispose().finally(() => { cleaned = true; app.quit(); });
  });
  }).catch(error => { console.error(error); app.quit(); });
}

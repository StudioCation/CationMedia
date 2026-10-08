import { dialog } from 'electron';
import { writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

const formats = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'png', 'jpg', 'webp']);
const modelFormats = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply']);
const sourceTextureExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'psd', 'tif', 'tiff', 'ktx2', 'bin']);
const safeStem = (value, stripExtension = true) => (stripExtension ? String(value || 'asset').replace(/\.[^.]+$/, '') : String(value || 'asset')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'asset';
function uniqueName(names, stem, extension) {
  let name = `${stem}.${extension}`, index = 2;
  while (names.has(name.toLowerCase())) name = `${stem}_${index++}.${extension}`;
  names.add(name.toLowerCase()); return name;
}
export async function saveTextureBatch(window, payload) {
  if (!payload || !['png', 'jpg', 'webp'].includes(payload.format) || !Array.isArray(payload.files) || !payload.files.length || payload.files.length > 2048 || payload.files.some(file => !(file.data instanceof Uint8Array)) || payload.files.reduce((sum, file) => sum + file.data.byteLength, 0) > 512 * 1024 * 1024) throw new Error('Invalid texture export batch.');
  const result = await dialog.showOpenDialog(window, { title: 'Choose a folder for converted textures', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const folder = await mkdtemp(path.join(result.filePaths[0], 'CationMedia-textures-'));
  const names = new Set();
  for (const file of payload.files) {
    const base = String(file.name || 'texture').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'texture';
    let name = `${base}.${payload.format}`, index = 2;
    while (names.has(name.toLowerCase())) name = `${base}_${index++}.${payload.format}`;
    names.add(name.toLowerCase());
    try { await writeFile(path.join(folder, name), file.data, { flag: 'wx' }); }
    catch (error) { throw new Error(`Export incomplete in ${folder}: ${error.message}`); }
  }
  return { folder, count: payload.files.length };
}
export async function saveSourceTextureBatch(window, payload) {
  if (!Array.isArray(payload?.files) || !payload.files.length || payload.files.length > 2048 ||
      payload.files.some(file => !(file.data instanceof Uint8Array) || !sourceTextureExtensions.has(path.extname(String(file.name)).slice(1).toLowerCase())) ||
      payload.files.reduce((sum, file) => sum + file.data.byteLength, 0) > 512 * 1024 * 1024) throw new Error('Invalid source texture batch.');
  const result = await dialog.showOpenDialog(window, { title: 'Choose a folder for original texture bytes', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const folder = await mkdtemp(path.join(result.filePaths[0], 'CationMedia-source-textures-'));
  const names = new Set();
  for (const file of payload.files) {
    const extension = path.extname(file.name).slice(1).toLowerCase();
    const name = uniqueName(names, safeStem(file.name), extension);
    try { await writeFile(path.join(folder, name), file.data, { flag: 'wx' }); }
    catch (error) { throw new Error(`Source texture export incomplete in ${folder}: ${error.message}`); }
  }
  return { folder, count: payload.files.length, embedded: payload.files.filter(file => file.origin === 'embedded image').length };
}
export async function saveModelBatch(window, payload, { blender, blenderPath } = {}) {
  if (!modelFormats.has(payload?.format) || !Array.isArray(payload.files) || !payload.files.length || payload.files.length > 2048 ||
      payload.files.some(file => !(file.data instanceof Uint8Array)) ||
      payload.files.reduce((sum, file) => sum + file.data.byteLength, 0) > 512 * 1024 * 1024) throw new Error('Invalid mesh export batch.');
  if (payload.format === 'fbx' && !blender) throw new Error('Blender is required for FBX export.');
  const result = await dialog.showOpenDialog(window, { title: 'Choose a folder for separate meshes', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const folder = await mkdtemp(path.join(result.filePaths[0], 'CationMedia-meshes-'));
  const names = new Set();
  for (const file of payload.files) {
    const name = uniqueName(names, safeStem(file.name, false), payload.format), destination = path.join(folder, name);
    try {
      if (payload.format === 'fbx') await blender.exportFbx(file.data, destination, blenderPath);
      else await writeFile(destination, file.data, { flag: 'wx' });
    } catch (error) { throw new Error(`Mesh export incomplete in ${folder}: ${error.message}`); }
  }
  return { folder, count: payload.files.length };
}
export async function saveExport(window, payload, { blender, blenderPath } = {}) {
  if (!payload || !formats.has(payload.format) || !(payload.data instanceof Uint8Array) || payload.data.byteLength > 512 * 1024 * 1024) throw new Error('Invalid export data.');
  const name = String(payload.name || 'model').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
  const result = await dialog.showSaveDialog(window, { title: 'Save converted file', defaultPath: `${name}.${payload.format}`, filters: [{ name: payload.format.toUpperCase(), extensions: [payload.format] }] });
  if (result.canceled || !result.filePath) return null;
  const file = path.extname(result.filePath).toLowerCase() === `.${payload.format}` ? result.filePath : `${result.filePath}.${payload.format}`;
  if (payload.format === 'fbx') {
    if (!blender) throw new Error('Blender is required for FBX export.');
    await blender.exportFbx(payload.data, file, blenderPath);
  } else await writeFile(file, payload.data);
  return path.basename(file);
}

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, realpath, stat, lstat, writeFile, unlink, readFile, open as openFile, rename } from 'node:fs/promises';
import { realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isImage, imageExtension, imageExportFormats } from '../shared/image.mjs';
import { inside } from './files.mjs';

const MAX_FILE_BYTES = 96 * 1024 * 1024;
const MAX_PIPE_BYTES = 256 * 1024 * 1024;
const formats = Object.freeze({ png: 'png', jpg: 'mjpeg', webp: 'libwebp', bmp: 'bmp', tiff: 'tiff', gif: 'gif' });
const mime = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' });
const suffix = format => format === 'jpg' ? 'jpg' : format;
const sameFile = (a, b) => process.platform === 'win32' ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() : path.normalize(a) === path.normalize(b);
const validEntryName = name => typeof name === 'string' && name.length > 0 && name.length <= 255 &&
  name !== '.' && name !== '..' && !/[\\/:*?"<>|\x00-\x1f]/.test(name) && !/[. ]$/.test(name) &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name);

export function resolveBrowserPath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes(String.fromCharCode(0)) || /^[a-zA-Z]:/.test(relative)) throw new Error('Invalid browser path.');
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) throw new Error('Path leaves the selected folder.');
  return candidate;
}
function pngBuffer(data) {
  if (typeof data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > MAX_PIPE_BYTES * 1.4) throw new Error('Invalid PNG export data.');
  const bytes = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
  if (bytes.length < 24 || bytes.length > MAX_PIPE_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG image.');
  if (bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(16) > 16384 || bytes.readUInt32BE(20) > 16384 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 64_000_000) throw new Error('Invalid PNG dimensions.');
  return bytes;
}
function runCodec(executable, args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let bytes = 0, errorText = '', settled = false;
    const fail = error => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(error); };
    const timer = setTimeout(() => fail(new Error('Image conversion timed out.')), 60_000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_PIPE_BYTES) fail(new Error('Converted image is too large.')); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { errorText = (errorText + String(chunk)).slice(-4096); });
    child.on('error', fail);
    child.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code !== 0) reject(new Error(errorText.trim() || 'Image conversion failed.'));
      else resolve(Buffer.concat(chunks));
    });
    if (input) child.stdin.end(input); else child.stdin.end();
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') fail(error); });
  });
}

export class ImageFileService {
  constructor({ app, window, dialog, grants, ffmpeg }) {
    this.app = app; this.window = window; this.dialog = dialog; this.grants = grants; this.ffmpeg = ffmpeg;
    this.sessions = new Map(); this.documents = new Map();
  }
  async newSession(folder) {
    const root = await realpath(folder);
    if (!(await stat(root)).isDirectory()) throw new Error('Select a folder.');
    for (const [id, session] of this.sessions) if (sameFile(session.root, root)) {
      this.sessions.delete(id); this.sessions.set(id, session); return id;
    }
    const id = randomUUID(), token = randomUUID(), allowed = new Set();
    this.sessions.set(id, { root, token, allowed });
    this.grants.set(token, { root, allowed });
    while (this.sessions.size > 32) {
      const active = new Set([...this.documents.values()].map(document => document.sessionId));
      const stale = [...this.sessions].find(([sessionId]) => sessionId !== id && !active.has(sessionId));
      if (!stale) break;
      this.sessions.delete(stale[0]); this.grants.delete(stale[1].token);
    }
    return id;
  }
  session(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Image browser session expired.');
    this.sessions.delete(id); this.sessions.set(id, session);
    if (!this.grants.has(session.token)) this.grants.set(session.token, { root: session.root, allowed: session.allowed });
    return session;
  }
  async checked(id, relative, kind) {
    const session = this.session(id), absolute = await realpath(resolveBrowserPath(session.root, relative));
    if (!inside(session.root, absolute)) throw new Error('Path leaves the selected folder.');
    const info = await stat(absolute);
    if (kind === 'file' && (!info.isFile() || !isImage(absolute) || info.size > MAX_FILE_BYTES)) throw new Error('Select a supported image within the folder.');
    if (kind === 'directory' && !info.isDirectory()) throw new Error('Select a folder.');
    return absolute;
  }
  async entryName(id, relative) {
    const session = this.session(id), absolute = await this.checked(id, relative);
    if (sameFile(absolute, session.root)) throw new Error('Select a file or folder inside the browser root.');
    const info = await stat(absolute);
    if (!info.isDirectory() && (!info.isFile() || !isImage(absolute))) throw new Error('Select an image or folder.');
    return path.basename(absolute);
  }
  async renameEntry(id, relative, name, { browserSessionId, browserRelative, documentId } = {}) {
    if (!validEntryName(name)) throw new Error('Invalid file or folder name.');
    const session = this.session(id), requested = resolveBrowserPath(session.root, relative);
    const source = await this.checked(id, relative);
    if (sameFile(source, session.root) || !sameFile(source, requested)) throw new Error('The browser root or a linked entry cannot be renamed.');
    const info = await stat(source), directory = info.isDirectory();
    if (!directory && (!info.isFile() || !isImage(source))) throw new Error('Select an image or folder.');
    if (!directory && imageExtension(name) !== imageExtension(source)) throw new Error('Renaming cannot change the image extension.');
    const destination = path.join(path.dirname(source), name);
    if (!inside(session.root, destination)) throw new Error('Path leaves the selected folder.');
    if (!sameFile(source, destination)) {
      try { await lstat(destination); throw new Error('A file or folder with this name already exists.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const currentFolder = browserSessionId ? await this.checked(browserSessionId, browserRelative, 'directory') : null;
    const activeDocument = documentId ? this.documents.get(documentId) : null;
    const documentAffected = activeDocument && (sameFile(path.dirname(activeDocument.file), path.dirname(source)) || directory && inside(source, activeDocument.file));
    await rename(source, destination);
    const moved = file => sameFile(file, source) || directory && inside(source, file) ? path.join(destination, path.relative(source, file)) : file;
    for (const item of this.sessions.values()) {
      item.root = moved(item.root);
      const allowed = [...item.allowed].map(moved);
      item.allowed.clear();
      for (const file of allowed) item.allowed.add(file);
      const grant = this.grants.get(item.token);
      if (grant) grant.root = item.root;
    }
    for (const document of this.documents.values()) document.file = moved(document.file);
    const browser = currentFolder ? await this.browse(browserSessionId, path.relative(this.session(browserSessionId).root, moved(currentFolder))) : null;
    let active = null;
    if (documentAffected) {
      const docSession = this.session(activeDocument.sessionId);
      const docBrowser = await this.browse(activeDocument.sessionId, path.relative(docSession.root, path.dirname(activeDocument.file)));
      const entry = docBrowser.entries.find(item => !item.directory && sameFile(path.join(docBrowser.root, item.relative), activeDocument.file));
      if (entry) active = { name: entry.name, relative: entry.relative, sessionId: activeDocument.sessionId, browser: docBrowser };
    }
    return { name, directory, oldRelative: relative, newRelative: path.relative(this.session(id).root, destination), oldFolder: source, newFolder: destination, browser, document: active };
  }
  dragPath(id, relative) {
    const session = this.session(id);
    const absolute = realpathSync(resolveBrowserPath(session.root, relative));
    if (!inside(session.root, absolute)) throw new Error('Path leaves the selected folder.');
    const info = statSync(absolute);
    if (!info.isFile() || !isImage(absolute) || info.size > MAX_FILE_BYTES) throw new Error('Select a supported image within the folder.');
    return absolute;
  }
  dragPaths(id, relatives) {
    if (!Array.isArray(relatives) || !relatives.length) throw new Error('Select images to drag.');
    return [...new Set(relatives.map(relative => this.dragPath(id, relative)))];
  }
  async dragThumbnail(id, relative) {
    const file = await this.checked(id, relative, 'file');
    return runCodec(this.ffmpeg, ['-i', file, '-frames:v', '1', '-vf', 'scale=160:160:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1']);
  }
  async browse(id, relative = '') {
    const session = this.session(id), folder = await this.checked(id, relative, 'directory');
    const entries = [];
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (!item.isDirectory() && !isImage(item.name)) continue;
      try {
        const absolute = await realpath(path.join(folder, item.name));
        if (!inside(session.root, absolute)) continue;
        const info = await stat(absolute), directory = info.isDirectory();
        if (!directory && (!info.isFile() || !isImage(item.name) || info.size > MAX_FILE_BYTES)) continue;
        const entry = { name: item.name, relative: path.relative(session.root, absolute), directory, size: directory ? 0 : info.size };
        if (!directory) {
          session.allowed.add(absolute);
          entry.url = 'model://' + session.token + '/' + entry.relative.split(path.sep).map(encodeURIComponent).join('/');
        }
        entries.push(entry);
      } catch { /* Unreadable folder entries are omitted. */ }
    }
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { sessionId: id, root: session.root, volumeRoot: path.parse(session.root).root, folder, relative: path.relative(session.root, folder), entries };
  }
  async folderBranch(id, relative = '') {
    const session = this.session(id), folder = await this.checked(id, relative, 'directory');
    const entries = [];
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (!item.isDirectory() && !item.isSymbolicLink()) continue;
      try {
        const absolute = await realpath(path.join(folder, item.name));
        if (!inside(session.root, absolute) || !(await stat(absolute)).isDirectory()) continue;
        entries.push({ name: item.name, relative: path.relative(session.root, absolute), directory: true });
      } catch { /* Unreadable folders are omitted. */ }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { sessionId: id, root: session.root, volumeRoot: path.parse(session.root).root, folder, relative: path.relative(session.root, folder), entries };
  }
  async locations() {
    const candidates = [];
    if (process.platform === 'win32') for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      candidates.push({ id: `drive:${letter}`, name: `${letter}:`, folder: `${letter}:\\`, kind: 'drive' });
    } else candidates.push({ id: 'drive:root', name: '/', folder: '/', kind: 'drive' });
    const home = os.homedir();
    const known = name => {
      try { return this.app?.getPath(name) || path.join(home, name[0].toUpperCase() + name.slice(1)); }
      catch { return path.join(home, name[0].toUpperCase() + name.slice(1)); }
    };
    for (const name of ['desktop', 'documents', 'pictures']) candidates.push({ id: name, name: name[0].toUpperCase() + name.slice(1), folder: known(name), kind: 'shortcut' });
    if (process.platform === 'win32') {
      const cloudFolders = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(home, 'Dropbox')].filter(Boolean);
      const seen = new Set();
      for (const folder of cloudFolders) {
        const key = path.normalize(folder).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ id: `cloud:${seen.size}`, name: path.basename(folder), folder, kind: 'shortcut' });
      }
    }
    for (const name of ['downloads', 'music', 'videos']) candidates.push({ id: name, name: name[0].toUpperCase() + name.slice(1), folder: known(name), kind: 'shortcut' });
    candidates.push({ id: 'home', name: 'Home', folder: home, kind: 'shortcut' });
    const found = await Promise.all(candidates.map(async location => {
      try { return (await stat(location.folder)).isDirectory() ? location : null; } catch { return null; }
    }));
    return found.filter(Boolean);
  }
  async openLocation(id) {
    if (typeof id !== 'string') throw new Error('Invalid location.');
    const location = (await this.locations()).find(item => item.id === id);
    if (!location) throw new Error('Location is unavailable.');
    const folder = await realpath(location.folder);
    const sessionId = await this.newSession(path.parse(folder).root);
    return this.browse(sessionId, path.relative(this.session(sessionId).root, folder));
  }
  async treeLocation(id) {
    if (typeof id !== 'string') throw new Error('Invalid location.');
    const location = (await this.locations()).find(item => item.id === id);
    if (!location) throw new Error('Location is unavailable.');
    const folder = await realpath(location.folder);
    const sessionId = await this.newSession(path.parse(folder).root);
    return this.folderBranch(sessionId, path.relative(this.session(sessionId).root, folder));
  }
  async treeContext(id, relative = '') {
    const folder = await this.checked(id, relative, 'directory');
    const root = path.parse(folder).root;
    const sessionId = await this.newSession(root);
    const segments = path.relative(root, folder).split(path.sep).filter(Boolean);
    const ancestors = Array.from({ length: segments.length + 1 }, (_, depth) => segments.slice(0, depth).join(path.sep));
    const branches = await Promise.all(ancestors.map(ancestor => this.folderBranch(sessionId, ancestor)));
    return { browser: await this.browse(sessionId, path.relative(root, folder)), branches };
  }
  async ancestor(id, relative = '', levels = 1) {
    if (!Number.isSafeInteger(levels) || levels < 1 || levels > 64) throw new Error('Invalid parent folder.');
    let folder = await this.checked(id, relative, 'directory');
    for (let index = 0; index < levels; index++) {
      const parent = path.dirname(folder);
      if (sameFile(parent, folder)) return null;
      folder = parent;
    }
    const sessionId = await this.newSession(path.parse(folder).root);
    return this.browse(sessionId, path.relative(this.session(sessionId).root, folder));
  }
  async open(file) {
    const absolute = await realpath(file);
    if (!(await stat(absolute)).isFile() || !isImage(absolute)) throw new Error('Select a supported image.');
    const id = await this.newSession(path.dirname(absolute));
    return this.openEntry(id, path.basename(absolute));
  }
  async openEntry(id, relative) {
    const absolute = await this.checked(id, relative, 'file');
    const documentId = randomUUID(), session = this.session(id), browser = await this.browse(id, path.dirname(path.relative(session.root, absolute)));
    const entry = browser.entries.find(item => !item.directory && sameFile(path.join(session.root, item.relative), absolute));
    if (!entry) throw new Error('Image is unavailable in this folder.');
    this.documents.set(documentId, { file: absolute, sessionId: id });
    while (this.documents.size > 24) this.documents.delete(this.documents.keys().next().value);
    return { name: path.basename(absolute), mediaType: 'image', documentId, sessionId: id, relative: entry.relative, url: entry.url, extension: imageExtension(absolute), browser };
  }
  async chooseFolder() {
    const result = await this.dialog.showOpenDialog(this.window, { title: 'Select image folder', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = await realpath(result.filePaths[0]);
    const id = await this.newSession(path.parse(folder).root);
    return this.browse(id, path.relative(this.session(id).root, folder));
  }
  async decode(id, relative, thumbnail = false) {
    const file = await this.checked(id, relative, 'file');
    if (!['tif', 'tiff'].includes(imageExtension(file))) throw new Error('Only TIFF images need native decoding.');
    const args = ['-i', file, '-frames:v', '1'];
    if (thumbnail) args.push('-vf', 'scale=240:240:force_original_aspect_ratio=decrease');
    args.push('-f', 'image2pipe', '-vcodec', 'png', 'pipe:1');
    const png = await runCodec(this.ffmpeg, args);
    return 'data:image/png;base64,' + png.toString('base64');
  }
  async read(id, relative) {
    const file = await this.checked(id, relative, 'file'), ext = imageExtension(file);
    if (ext === 'tif' || ext === 'tiff') return this.decode(id, relative);
    const bytes = await readFile(file);
    return 'data:' + mime[ext] + ';base64,' + bytes.toString('base64');
  }
  async encoded(data, format) {
    const png = pngBuffer(data);
    if (format === 'png') return png;
    if (!imageExportFormats.includes(format)) throw new Error('Unsupported image format.');
    if (format === 'gif') return runCodec(this.ffmpeg, ['-f', 'image2pipe', '-vcodec', 'png', '-i', 'pipe:0', '-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'gif', 'pipe:1'], png);
    const args = ['-f', 'image2pipe', '-vcodec', 'png', '-i', 'pipe:0', '-frames:v', '1'];
    if (format === 'jpg' || format === 'bmp') args.push('-pix_fmt', 'rgb24');
    args.push('-f', 'image2pipe', '-vcodec', formats[format], 'pipe:1');
    return runCodec(this.ffmpeg, args, png);
  }
  async destination(defaultPath, format) {
    const result = await this.dialog.showSaveDialog(this.window, { defaultPath, filters: [{ name: format.toUpperCase(), extensions: [suffix(format)] }] });
    if (result.canceled || !result.filePath) return null;
    const extension = '.' + suffix(format);
    return path.extname(result.filePath).toLowerCase() === extension ? result.filePath : result.filePath + extension;
  }
  async save(documentId, { format, data }) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error('Image document expired.');
    if (!imageExportFormats.includes(format)) throw new Error('Unsupported image format.');
    const defaultPath = path.join(path.dirname(doc.file), path.parse(doc.file).name + '-edited.' + suffix(format));
    const destination = await this.destination(defaultPath, format);
    if (!destination) return null;
    if (sameFile(destination, doc.file)) throw new Error('Choose a new file to preserve the source.');
    const bytes = await this.encoded(data, format);
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Image export is too large.');
    await writeFile(destination, bytes, { flag: 'wx' });
    const file = await realpath(destination);
    const sessionId = await this.newSession(path.dirname(file));
    const browser = await this.browse(sessionId);
    const entry = browser.entries.find(item => !item.directory && sameFile(path.join(browser.root, item.relative), file));
    if (!entry) throw new Error('Saved image is unavailable in the selected folder.');
    this.documents.set(documentId, { file, sessionId });
    return { name: path.basename(file), size: bytes.length, sessionId, relative: entry.relative, url: entry.url, browser, extension: imageExtension(file) };
  }
  async saveChanges(documentId, { data } = {}) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error('Image document expired.');
    const session = this.session(doc.sessionId);
    const source = await realpath(doc.file);
    if (!sameFile(source, doc.file) || !inside(session.root, source)) throw new Error('Image source has changed.');
    const info = await stat(source);
    if (!info.isFile() || !isImage(source) || info.size > MAX_FILE_BYTES) throw new Error('Image source is unavailable.');
    const extension = imageExtension(source);
    const format = extension === 'jpeg' ? 'jpg' : extension === 'tif' ? 'tiff' : extension;
    if (!imageExportFormats.includes(format)) throw new Error('Unsupported image format.');
    const bytes = await this.encoded(data, format);
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Image export is too large.');
    const temporary = path.join(path.dirname(source), `.${path.basename(source)}.cation-${randomUUID()}.tmp`);
    let created = false;
    try {
      const file = await openFile(temporary, 'wx');
      created = true;
      try { await file.writeFile(bytes); await file.sync(); }
      finally { await file.close(); }
      if (!sameFile(await realpath(doc.file), source)) throw new Error('Image source has changed.');
      await rename(temporary, source);
      return { name: path.basename(source), size: bytes.length, format };
    } finally {
      if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async saveAtlas(sessionId, { format, data, width, height, frames }) {
    const session = this.session(sessionId);
    if (!['png', 'webp'].includes(format) || !Array.isArray(frames) || !frames.length) throw new Error('Invalid atlas export.');
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64_000_000) throw new Error('Invalid atlas dimensions.');
    const outputFrames = [];
    for (const frame of frames) {
      const absolute = await this.checked(sessionId, frame.relative, 'file');
      for (const key of ['x', 'y', 'width', 'height']) if (!Number.isSafeInteger(frame[key]) || frame[key] < 0) throw new Error('Invalid atlas frame.');
      if (!frame.width || !frame.height || frame.x + frame.width > width || frame.y + frame.height > height) throw new Error('Atlas frame exceeds the image.');
      outputFrames.push({ name: path.relative(session.root, absolute).split(path.sep).join('/'), x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    }
    const destination = await this.destination(path.join(session.root, 'atlas.' + format), format);
    if (!destination) return null;
    const jsonPath = path.join(path.dirname(destination), path.parse(destination).name + '.json');
    const sourcePng = pngBuffer(data);
    if (sourcePng.readUInt32BE(16) !== width || sourcePng.readUInt32BE(20) !== height) throw new Error('Atlas metadata does not match the image.');
    const bytes = await this.encoded(data, format);
    await writeFile(destination, bytes, { flag: 'wx' });
    try { await writeFile(jsonPath, JSON.stringify({ image: path.basename(destination), width, height, frames: outputFrames }, null, 2), { flag: 'wx' }); }
    catch (error) { await unlink(destination).catch(() => {}); throw error; }
    return { name: path.basename(destination), metadata: path.basename(jsonPath), size: bytes.length };
  }
}

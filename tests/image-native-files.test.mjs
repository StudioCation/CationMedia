import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ImageFileService } from '../electron/ImageFileService.mjs';

const png = await readFile(new URL('../public/icon.png', import.meta.url));

test('native image drag only resolves supported files inside the live browser session', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-drag-'));
  try {
    const source = path.join(folder, 'PHOTO.PNG');
    await writeFile(source, png);
    await writeFile(path.join(folder, 'note.txt'), 'not an image');
    const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg: '' });
    const sessionId = await service.newSession(folder);
    assert.equal(service.dragPath(sessionId, 'PHOTO.PNG'), source);
    assert.throws(() => service.dragPath(sessionId, '../PHOTO.PNG'), /leaves the selected folder/);
    assert.throws(() => service.dragPath(sessionId, 'note.txt'), /supported image/);
    assert.throws(() => service.dragPath(sessionId, ''), /supported image/);
    assert.throws(() => service.dragPath('expired-session', 'PHOTO.PNG'), /expired/);
    await writeFile(path.join(folder, 'SECOND.PNG'), png);
    assert.deepEqual(service.dragPaths(sessionId, ['PHOTO.PNG', 'SECOND.PNG', 'PHOTO.PNG']), [source, path.join(folder, 'SECOND.PNG')]);
    assert.throws(() => service.dragPaths(sessionId, ['PHOTO.PNG', '../PHOTO.PNG']), /leaves the selected folder/);
    assert.throws(() => service.dragPaths(sessionId, ['PHOTO.PNG', 'note.txt']), /supported image/);
    assert.throws(() => service.dragPaths(sessionId, []), /Select images/);
    assert.throws(() => service.dragPaths(sessionId, 'PHOTO.PNG'), /Select images/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('file browser moves from an opened image folder to its parent and into sibling folders', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-browse-'));
  try {
    const sourceFolder = path.join(folder, 'source');
    const siblingFolder = path.join(folder, 'sibling');
    await mkdir(sourceFolder); await mkdir(siblingFolder);
    await writeFile(path.join(sourceFolder, 'original.png'), png);
    await writeFile(path.join(siblingFolder, 'other.png'), png);
    const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg: '' });
    const opened = await service.open(path.join(sourceFolder, 'original.png'));
    const tree = await service.treeContext(opened.sessionId, opened.browser.relative);
    assert.equal(tree.browser.folder, sourceFolder);
    assert.equal(tree.browser.root, path.parse(sourceFolder).root);
    assert.deepEqual(tree.branches.slice(-2).map(branch => branch.folder), [folder, sourceFolder]);
    assert.deepEqual(tree.branches.at(-2).entries.filter(entry => entry.directory).map(entry => entry.name), ['sibling', 'source']);
    const parent = await service.ancestor(opened.sessionId, opened.browser.relative, 1);
    assert.equal(parent.folder, folder);
    assert.deepEqual(parent.entries.filter(entry => entry.directory).map(entry => entry.name), ['sibling', 'source']);
    const sibling = parent.entries.find(entry => entry.name === 'sibling');
    const browsed = await service.browse(parent.sessionId, sibling.relative);
    assert.deepEqual(browsed.entries.map(entry => entry.name), ['other.png']);
    assert.equal(service.session(opened.sessionId).root, sourceFolder);
    await assert.rejects(service.ancestor(opened.sessionId, '', 0), /Invalid parent folder/);
    await assert.rejects(service.openLocation('missing-drive'), /unavailable/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('file browser lists local locations and opens only an issued location', async () => {
  const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg: '' });
  const locations = await service.locations();
  assert.ok(locations.some(location => location.id === 'home' && location.kind === 'shortcut'));
  assert.ok(locations.some(location => location.kind === 'drive'));
  const home = await service.openLocation('home');
  assert.equal(home.folder, await realpath(os.homedir()));
  assert.equal(home.root, path.parse(home.folder).root);
  await assert.rejects(service.openLocation(os.homedir()), /unavailable/);
});

test('renaming image and parent folder preserves the active document and browser session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cation-image-rename-'));
  try {
    const folder = path.join(root, 'source');
    await mkdir(folder);
    await writeFile(path.join(folder, 'original.png'), png);
    const grants = new Map();
    const service = new ImageFileService({ window: {}, dialog: {}, grants, ffmpeg: '' });
    const opened = await service.open(path.join(folder, 'original.png'));
    const browserSessionId = await service.newSession(root);
    await service.browse(browserSessionId, 'source');
    assert.equal(await service.entryName(browserSessionId, path.join('source', 'original.png')), 'original.png');

    const file = await service.renameEntry(browserSessionId, path.join('source', 'original.png'), 'renamed.png', {
      browserSessionId, browserRelative: 'source', documentId: opened.documentId
    });
    assert.equal(file.browser.folder, folder);
    assert.deepEqual(file.browser.entries.map(entry => entry.name), ['renamed.png']);
    assert.equal(file.document.name, 'renamed.png');
    assert.equal(service.documents.get(opened.documentId).file, path.join(folder, 'renamed.png'));
    assert.equal((await service.read(opened.sessionId, 'renamed.png')).startsWith('data:image/png;base64,'), true);

    const directory = await service.renameEntry(browserSessionId, 'source', 'renamed-folder', {
      browserSessionId, browserRelative: 'source', documentId: opened.documentId
    });
    assert.equal(directory.browser.folder, path.join(root, 'renamed-folder'));
    assert.equal(directory.document.browser.folder, path.join(root, 'renamed-folder'));
    assert.equal(service.session(opened.sessionId).root, path.join(root, 'renamed-folder'));
    assert.equal(service.documents.get(opened.documentId).file, path.join(root, 'renamed-folder', 'renamed.png'));
    assert.equal(await service.entryName(browserSessionId, 'renamed-folder'), 'renamed-folder');
    assert.deepEqual(await readdir(root), ['renamed-folder']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rename refuses collisions, path escapes, invalid names and image extension changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cation-image-rename-invalid-'));
  try {
    await writeFile(path.join(root, 'original.png'), png);
    await writeFile(path.join(root, 'taken.png'), png);
    const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg: '' });
    const sessionId = await service.newSession(root);
    for (const name of ['taken.png', '../escape.png', 'bad/name.png', 'bad\\name.png', 'CON.png', 'trailing. ', 'changed.jpg']) {
      await assert.rejects(service.renameEntry(sessionId, 'original.png', name), /rename|name|exists|extension/i);
    }
    await assert.rejects(service.renameEntry(sessionId, '', 'renamed'), /root|folder|rename/i);
    assert.deepEqual((await readdir(root)).sort(), ['original.png', 'taken.png']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Save writes the original image format through a temporary sibling and removes it', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-save-'));
  try {
    const source = path.join(folder, 'PHOTO.JPEG');
    await writeFile(source, Buffer.from('old image'));
    const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg: '' });
    const descriptor = await service.open(source);
    let encodedFormat = null;
    service.encoded = async (_data, format) => { encodedFormat = format; return Buffer.from('new jpeg image'); };
    const result = await service.saveChanges(descriptor.documentId, { data: 'image data', format: 'png' });
    assert.equal(encodedFormat, 'jpg');
    assert.deepEqual(result, { name: 'PHOTO.JPEG', size: 14, format: 'jpg' });
    assert.equal((await readFile(source)).toString(), 'new jpeg image');
    assert.deepEqual(await readdir(folder), ['PHOTO.JPEG']);
    await assert.rejects(service.saveChanges('expired-document', { data: 'image data' }), /expired/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('invalid Save data leaves the original image untouched', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-save-invalid-'));
  try {
    const source = path.join(folder, 'original.png');
    const previous = Buffer.concat([png, Buffer.from('old data')]);
    await writeFile(source, previous);
    const service = new ImageFileService({ window: {}, dialog: {}, grants: new Map(), ffmpeg: '' });
    const descriptor = await service.open(source);
    await assert.rejects(service.saveChanges(descriptor.documentId, { data: 'invalid' }), /Invalid PNG export data/);
    assert.deepEqual(await readFile(source), previous);
    assert.deepEqual(await readdir(folder), ['original.png']);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('Save As switches the active document and a cancelled Save As keeps its path', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cation-image-save-as-'));
  try {
    const source = path.join(folder, 'original.png');
    const destination = path.join(folder, 'new.png');
    await writeFile(source, png);
    let canceled = false;
    const dialog = { showSaveDialog: async () => canceled ? { canceled: true } : { canceled: false, filePath: destination } };
    const service = new ImageFileService({ window: {}, dialog, grants: new Map(), ffmpeg: '' });
    const descriptor = await service.open(source);
    assert.equal(await service.save(descriptor.documentId, { format: 'png', data: 'data:image/png;base64,' + png.toString('base64') }).then(result => result.name), 'new.png');
    assert.equal(service.documents.get(descriptor.documentId).file, destination);
    canceled = true;
    assert.equal(await service.save(descriptor.documentId, { format: 'png', data: 'data:image/png;base64,' + png.toString('base64') }), null);
    assert.equal(service.documents.get(descriptor.documentId).file, destination);
    const updated = Buffer.concat([png, Buffer.from('new content')]);
    await service.saveChanges(descriptor.documentId, { data: 'data:image/png;base64,' + updated.toString('base64') });
    assert.deepEqual(await readFile(destination), updated);
    assert.deepEqual(await readFile(source), png);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

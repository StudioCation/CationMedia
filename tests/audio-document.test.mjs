import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

// Load the UI module's SVG imports without starting an HTTP server or building.
const modules = await createServer({ server: { middlewareMode: true }, appType: 'custom', configFile: false });
const { AudioWorkspace } = await modules.ssrLoadModule('/src/components/AudioWorkspace.mjs');
const { AudioTimeline } = await modules.ssrLoadModule('/src/components/AudioTimeline.mjs');
await modules.close();

function workspace() {
  const audio = Object.create(AudioWorkspace.prototype), nodes = new Map();
  Object.assign(audio, { channels: [new Float32Array([0.2, 0.4, 0.1])], sampleRate: 44100, selection: [0, 0], cursor: 0, loopRegions: [], history: [], future: [], name: 'source.mp3', saveFormat: 'mp3', documentId: 'opened-document', host: { dataset: {} },
    $: id => { if (!nodes.has(id)) nodes.set(id, { value: '', replaceChildren() {}, showModal() {}, close() {} }); return nodes.get(id); },
    stop() {}, refresh() {}, changed() {}, message() {}, exportQuality() {}, job: async (_, action) => action()
  });
  audio.savedChannels = audio.channels;
  return audio;
}

test('dirty tracks the saved revision across undo and redo', () => {
  const audio = workspace();
  audio.remember(); audio.channels = [new Float32Array([0.5])];
  assert.equal(audio.dirty, true);
  audio.acceptSave({ name: 'saved.mp3', documentId: 'saved-document' });
  assert.equal(audio.dirty, false);
  audio.restore(audio.history, audio.future);
  assert.equal(audio.dirty, true, 'undo past the saved revision must be dirty');
  audio.restore(audio.future, audio.history);
  assert.equal(audio.dirty, false, 'redo to the saved revision must be clean');
});

test('undo after trimming and saving restores found loops on their original audio', () => {
  const audio = workspace();
  audio.sampleRate = 1;
  audio.channels = [new Float32Array(12)];
  const found = [{ start: 2, end: 5, bpm: 120, bars: 1, beatsPerBar: 4, levelError: 0 }];
  audio.loopRegions = found;
  audio.activeLoop = found[0];
  audio.loopHighlight = true;
  audio.loop = true;
  audio.selection = [2, 5];
  audio.refresh = (_peaks, { preserveLoops = false } = {}) => {
    if (!preserveLoops) { audio.loopRegions = []; audio.activeLoop = null; audio.loopHighlight = false; }
  };
  audio.remember();
  audio.channels = [audio.channels[0].slice(2, 5)];
  audio.selection = [0, 3];
  audio.refresh();
  audio.acceptSave({ name: 'trimmed.wav' });
  assert.deepEqual(audio.loopRegions, [], 'trimmed audio must not display stale coordinates');
  audio.restore(audio.history, audio.future);
  assert.equal(audio.channels[0].length, 12);
  assert.deepEqual(audio.loopRegions, found);
  assert.deepEqual(audio.selection, [2, 5]);
  audio.restore(audio.future, audio.history);
  assert.equal(audio.channels[0].length, 3);
  assert.deepEqual(audio.loopRegions, [], 'redo must not revive coordinates from the original file');
});

test('Save as defaults to current format while explicit conversion overrides it', async () => {
  const audio = workspace();
  await audio.command('export'); assert.equal(audio.$('format').value, 'mp3');
  await audio.command('export:flac'); assert.equal(audio.$('format').value, 'flac');
  await audio.command('export'); assert.equal(audio.$('format').value, 'mp3');
});

test('Save As on a found loop exports only its exact sample range', async () => {
  const audio = workspace(), region = { start: 2, end: 5 };
  audio.sampleRate = 1;
  audio.channels = [Float32Array.from({ length: 8 }, (_, i) => i / 10)];
  audio.loopRegions = [region]; audio.contextLoop = region;
  audio.openExportDialog = () => {};
  await audio.command('export-loop');
  assert.deepEqual(audio.exportRange, [2, 5]);
  audio.$('format').value = 'wav'; audio.$('quality').value = 'high'; audio.$('rate').value = '0'; audio.$('bitrate-fields').hidden = true;
  let payload;
  globalThis.window = { desktop: { exportAudio: async value => { payload = value; return null; } } };
  try {
    await audio.save();
    assert.equal(payload.selectionOnly, true);
    assert.deepEqual([...new Float32Array(payload.data.buffer, payload.data.byteOffset + 44, 3)], [...audio.channels[0].slice(2, 5)]);
  } finally { delete globalThis.window; }
});

test('timeline passes each layer volume into the worker mix', async () => {
  const timeline = Object.create(AudioTimeline.prototype);
  timeline.clips = [
    { channels: [new Float32Array([.8])], sampleRate: 1, start: 0, layer: 0 },
    { channels: [new Float32Array([.5])], sampleRate: 1, start: 0, layer: 1 }
  ];
  timeline.layerGains = [.25, 1.5]; timeline.editor = { sampleRate: 1 }; timeline.capture = () => {};
  const OriginalWorker = globalThis.Worker;
  let posted;
  globalThis.Worker = class {
    postMessage(payload) { posted = payload; this.onmessage({ data: { channels: [], sampleRate: 1 } }); }
    terminate() {}
  };
  try { await timeline.mix(); assert.deepEqual(posted.clips.map(clip => clip.gain), [.25, 1.5]); }
  finally { globalThis.Worker = OriginalWorker; }
});

test('switching timeline clips keeps found loops with their source clip', () => {
  const audio = workspace(), loop = { start: 1, end: 2 };
  audio.loopRegions = [loop]; audio.activeLoop = loop; audio.loopHighlight = true; audio.loop = true;
  audio.refresh = (_peaks, options) => { assert.equal(options.preserveLoops, true); };
  audio.closePreview = () => {};
  const first = { channels: audio.channels, sampleRate: audio.sampleRate, history: [], future: [], selection: [0, 0], cursor: 0, zoom: 1, offset: 0 };
  const second = { channels: [new Float32Array(4)], sampleRate: 1, history: [], future: [], selection: [0, 0], cursor: 0, zoom: 1, offset: 0, loopRegions: [], activeLoop: null, loopHighlight: false, loop: false };
  const timeline = Object.create(AudioTimeline.prototype);
  Object.assign(timeline, { editor: audio, active: first, stop() {} });
  timeline.select(second);
  assert.deepEqual(audio.loopRegions, []);
  timeline.select(first);
  assert.deepEqual(audio.loopRegions, [loop]);
  assert.equal(audio.activeLoop, loop);
});

test('save shortcuts work across keyboard layouts even with field focus', () => {
  const audio = workspace(), actions = [];
  audio.command = action => actions.push(action);
  globalThis.document = { querySelector: () => null };
  for (const key of ['s', 'ы', 'Ы', 'і', 'ش']) for (const shiftKey of [false, true]) {
    let prevented = false;
    audio.key({ ctrlKey: true, code: 'KeyS', key, shiftKey, target: { tagName: 'INPUT' }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.deepEqual(actions, Array.from({ length: 5 }, () => ['save', 'export']).flat());
  delete globalThis.document;
});

test('Save writes full audio to the current document and preserves dirty on cancellation or failure', async () => {
  const audio = workspace();
  audio.channels = [new Float32Array([0.9, 0.2])];
  let payload;
  globalThis.window = { desktop: { exportAudio: async value => { payload = value; return null; } } };
  try {
    assert.equal(await audio.saveChanges(), false); assert.equal(audio.dirty, true);
    assert.equal(payload.overwrite, true); assert.equal(payload.format, 'mp3'); assert.equal(payload.documentId, 'opened-document');
    window.desktop.exportAudio = async () => { throw new Error('write failed'); };
    await assert.rejects(audio.saveChanges(), /write failed/); assert.equal(audio.dirty, true);
    window.desktop.exportAudio = async () => ({ name: 'source.mp3', documentId: 'opened-document' });
    assert.equal(await audio.saveChanges(), true); assert.equal(audio.dirty, false);
  } finally { delete globalThis.window; }
});

import path from 'node:path';
import { saveAudio } from '../electron/AudioExportService.mjs';

test('native save dialog starts in the document folder and Save follows the last full Save as', async () => {
  const original = path.resolve('fixtures', 'music.mp3'), target = path.resolve('output', 'copy.mp3');
  const documents = new Map([['id', original]]), writes = [];
  let options, nextResult = { canceled: true };
  const dependencies = {
    documents, codec: { validate() {}, exportOptions() {}, encode: async () => new Uint8Array([1, 2]) },
    showSaveDialog: async (_, value) => { options = value; return nextResult; },
    writeFile: async file => { writes.push(file); }
  };
  const payload = { name: 'music.mp3', format: 'mp3', documentId: 'id' };
  assert.equal(await saveAudio(null, payload, dependencies), null);
  assert.equal(options.defaultPath, original); assert.equal(documents.get('id'), original);
  nextResult = { filePath: target };
  await saveAudio(null, { ...payload, selectionOnly: true }, dependencies);
  assert.equal(documents.get('id'), original, 'selection export must not change the current document');
  await saveAudio(null, payload, dependencies);
  assert.equal(documents.get('id'), target);
  dependencies.showSaveDialog = () => { throw new Error('Save must not open a dialog'); };
  await saveAudio(null, { ...payload, overwrite: true }, dependencies);
  assert.equal(writes.at(-1), target);
  dependencies.writeFile = async () => { throw new Error('disk error'); };
  await assert.rejects(saveAudio(null, { ...payload, overwrite: true }, dependencies), /disk error/);
  assert.equal(documents.get('id'), target);
});

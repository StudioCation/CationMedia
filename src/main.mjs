import './style.css';
import './workspace.css';
import './viewer3d.css';
import './controls.css';
import './audio.css';
import './video.css';
import './image.css';
import './home.css';
import { HomeScreen } from './components/HomeScreen.mjs';
import { FileDropManager } from './managers/FileDropManager.mjs';
import { AudioWorkspace } from './components/AudioWorkspace.mjs';
import { VideoWorkspace } from './components/VideoWorkspace.mjs';
import { ImageWorkspace } from './components/ImageWorkspace.mjs';
import { SceneManager, disposeObject } from './managers/SceneManager.mjs';
import { LoaderManager } from './managers/LoaderManager.mjs';
import { SceneTree } from './components/SceneTree.mjs';
import { renderLayout } from './components/Layout.mjs';
import { createDemo } from './demo.mjs';
import { TextureManager } from './managers/TextureManager.mjs';
import { isTexture, basename } from './managers/textureMatching.mjs';
import { SelectionManager } from './managers/SelectionManager.mjs';
import { PanelManager } from './managers/PanelManager.mjs';
import { ExportManager } from './managers/ExportManager.mjs';
import { ShadingManager } from './managers/ShadingManager.mjs';
import { TransformManager } from './managers/TransformManager.mjs';
import { MaterialPanel } from './components/MaterialPanel.mjs';
import { MediaSession } from './managers/MediaSession.mjs';
import { mediaType, detectMediaType, hasCapability } from '../shared/mediaTypes.mjs';
import { primaryDropFile } from '../shared/mediaDrop.mjs';
import { meshTextures, encodeTexture } from './managers/TextureExport.mjs';

renderLayout(document.querySelector('#app'));
document.querySelector('#app').classList.toggle('desktop', Boolean(window.desktop));
const $ = id => document.getElementById(id);
let viewer;
try { viewer = new SceneManager($('viewport'), updateTime); } catch (error) { $('status').textContent = 'WebGL unavailable'; $('viewport').textContent = `Unable to initialize 3D rendering: ${error.message}`; throw error; }
viewer.scene.background.set($('background').value);
viewer.invalidate();
const loader = new LoaderManager(viewer.renderer), tree = new SceneTree($('tree'), viewer);
const exporter = new ExportManager(viewer);
const shading = new ShadingManager(viewer.display);
const transform = new TransformManager(viewer);
const materialPanel = new MaterialPanel($('material-panel'), viewer, () => tree.render());
const media = new MediaSession($('app'), type => { viewer.setActive(type?.id === 'model3d'); menuState(); });
media.register('model3d', { load: descriptor => loader.load(descriptor), dispose: result => disposeObject(result.root), install: (result, name) => install(result.root, result.clips, name), deactivate: () => { selection.select(null); transform.select(null); materialPanel.select(null); viewer.animation.playing = false; } });
const selection = new SelectionManager(viewer, object => { tree.select(object, true); transform.select(object); materialPanel.select(object); updateStats(); });
transform.onDragStart = () => { selection.suppressClick = true; };
transform.onChange = () => selection.update();
tree.onSelect = object => selection.select(object);
function contextMenu(object) {
  if (busy || !viewer.root || document.querySelector('dialog[open]')) return;
  selection.select(object);
  void window.desktop?.contextMenu({ mediaType: media.type?.id, mode: shading.scopeMode(object || viewer.root), selected: Boolean(object), meshCount: exporter.meshes().length, sourceTextureCount: exporter.sourceTextureCount(), textures: meshTextures(object || viewer.root, viewer.display).map(({ id, name }) => ({ id, name })) }).catch(error => message(error.message));
}
selection.onContext = contextMenu; tree.onContext = contextMenu;
viewer.beforeRender = () => { transform.update(); selection.update(); };
function updateStats() {
  const object = selection.selected, stats = viewer.stats(object || viewer.root);
  $('stats-title').textContent = object ? object.name || object.type : 'Whole model';
  $('stats').textContent = `${stats.meshes.toLocaleString()} meshes · ${stats.vertices.toLocaleString()} vertices · ${stats.triangles.toLocaleString()} triangles`;
  menuState();
}
let busy = false, sequence = 0, currentOffer = null;
const audioHost = document.createElement('section'); audioHost.dataset.mediaView = 'audio'; audioHost.className = 'audio-workspace'; audioHost.hidden = true; document.querySelector('main').append(audioHost);
// Global feedback starts in the document shell; image loading moves into its preview.
$('app').append($('loading'), $('drop-overlay'));
const audio = new AudioWorkspace(audioHost, { message, busy: setBusy, open, changed: menuState });
const videoHost = document.createElement('section'); videoHost.dataset.mediaView = 'video'; videoHost.className = 'video-workspace'; videoHost.hidden = true; document.querySelector('main').append(videoHost);
const video = new VideoWorkspace(videoHost, { message, busy: setBusy });
media.register('video', { load: descriptor => video.load(descriptor), dispose: result => { if (result.ownedURL) URL.revokeObjectURL(result.url); }, install: (result, name) => { video.install(result, name); $('filename').textContent = name; }, deactivate: () => video.deactivate() });
const imageHost = document.createElement('section'); imageHost.dataset.mediaView = 'image'; imageHost.className = 'image-workspace'; imageHost.hidden = true; document.querySelector('main').append(imageHost);
const image = new ImageWorkspace(imageHost, { message, open: load, changed: menuState });
media.register('image', { load: descriptor => image.load(descriptor), install: (result, name) => { image.install(result); $('filename').textContent = name; menuState(); }, deactivate: () => image.deactivate() });
const panels = new PanelManager($('app'));
new HomeScreen(document.querySelector('main'), open);
media.register('audio', { load: descriptor => audio.load(descriptor), install: (result, name) => audio.install(result, name), deactivate: () => audio.deactivate() });
$('file-input').accept += ',' + mediaType('audio').extensions.map(ext => '.' + ext).join(',');
$('file-input').accept += ',' + mediaType('video').extensions.map(ext => '.' + ext).join(',');
$('file-input').accept += ',' + mediaType('image').extensions.map(ext => '.' + ext).join(',');
const allFileAccept = $('file-input').accept;
$('drop-overlay').querySelector('strong').textContent = 'Drop media files';
$('drop-overlay').querySelector('span').textContent = '3D models · Images · Audio · Video';
function menuState() {
  if (media.type?.id === 'audio' && audio.name) {
    $('filename').textContent = `${audio.name}${audio.dirty ? ' *' : ''}`;
    document.title = `${audio.name}${audio.dirty ? ' *' : ''} — CationMedia`;
  }
  if (media.type?.id === 'image' && image.name) {
    $('filename').textContent = image.name + (image.dirty ? ' *' : '');
    document.title = image.name + (image.dirty ? ' *' : '') + ' — CationMedia';
  }
  void window.desktop?.state({ mediaType: media.type?.id, model: Boolean(viewer.root), selected: Boolean(selection.selected?.isMesh), busy, audioDirty: media.type?.id === 'audio' && audio.dirty, imageDirty: media.type?.id === 'image' && image.dirty }); }
let audioDecisionPending = false;
async function canReplaceAudio() {
  if (audioDecisionPending) return false;
  if (media.type?.id !== 'audio' || !audio.dirty) return true;
  audio.stop(false);
  if (!window.desktop) return window.confirm('Continue without saving changes?');
  audioDecisionPending = true;
  try {
    const choice = await window.desktop.confirmAudioDiscard();
    return choice === 1 || (choice === 0 && await audio.saveChanges());
  } finally { audioDecisionPending = false; }
}
function message(text) { $('message').hidden = !text; $('message').querySelector('span').textContent = text; }
$('message').querySelector('button').onclick = () => message('');
function setBusy(value, label = 'Opening…') {
  busy = value;
  const loading = $('loading'), host = value && media.type?.id === 'image' ? image.q('preview') : $('app');
  loading.hidden = !value;
  if (loading.parentElement !== host) host.append(loading);
  loading.lastElementChild.textContent = label;
  $('open').disabled = value; $('status').textContent = value ? label : 'Ready'; menuState();
}
function updateTime() { if (!viewer) return; const animation = viewer.animation; const time = animation.action?.time ?? 0, duration = animation.clip?.duration ?? 0; $('seek').value = time; $('time').textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`; }
function syncAnimation() { const animation = viewer.animation; $('seek').max = animation.clip?.duration ?? 0; for (const id of ['clips', 'play', 'seek', 'speed']) $(id).disabled = !animation.clip; $('play').textContent = 'Play'; $('play').setAttribute('aria-label', 'Play animation'); updateTime(); }
function syncDisplayOptions() {
  const bones = viewer.display.bones();
  $('weight-bone').replaceChildren(...bones.map(bone => new Option(bone.name, bone.id)));
  if (viewer.display.weightBone) $('weight-bone').value = viewer.display.weightBone;
  $('weight-bone-field').hidden = viewer.display.mode !== 'weights' || !bones.length;
  $('show-bones').disabled = !bones.length;
  if (!bones.length) viewer.setBonesVisible(false);
  $('show-bones').checked = Boolean(bones.length && viewer.bonesVisible);
  document.querySelectorAll('.modes button[data-mode]').forEach(button => {
    const mode = button.dataset.mode;
    button.setAttribute('aria-pressed', String(mode === viewer.display.mode));
    button.disabled = !viewer.display.supports(mode);
    const hint = mode === 'vertex' ? 'Meshes without vertex colors appear gray.' : button.disabled ? 'This model has no skin weights or bones.' : '';
    button.title = `${button.getAttribute('aria-label')}${hint ? ` — ${hint}` : ''}`;
  });
}
async function canReplaceImage() { return media.type?.id !== 'image' || !image.dirty || image.maybeLeave(); }
function install(root, clips, name) { selection.select(null); shading.restore(); exporter.setSource(null, null); viewer.load(root, clips); syncDisplayOptions(); tree.render(root); $('filename').textContent = name; document.title = `${name} — CationMedia`; $('clips').replaceChildren(...clips.map((clip, index) => new Option(clip.name || `Animation ${index + 1}`, index))); if (!clips.length) $('clips').add(new Option('No animations', '')); syncAnimation(); updateStats(); }
async function load(descriptor) {
  if (!descriptor) { setBusy(false); return; }
  if (descriptor.pathPending) { setBusy(true); return; }
  if (descriptor.error) { message(descriptor.error); setBusy(false); return; }
  const ticket = ++sequence; currentOffer = null; $('texture-offer').hidden = true; setBusy(true); message('');
  try {
    const { type, adapter } = media.resolve(descriptor.name), result = await adapter.load(descriptor);
    if (ticket !== sequence) { adapter.dispose?.(result); return; }
    if (!await canReplaceAudio() || !await canReplaceImage() || ticket !== sequence) { adapter.dispose?.(result); return; }
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    media.activate(type); adapter.install(result, descriptor.name);
    if (type.id === 'model3d') exporter.setSource(descriptor, result.parser);
    if (type.id === 'audio') { menuState(); if (descriptor.autoplay) await audio.command('play'); }
    if (result.warnings) message(result.warnings);
    if (descriptor.textureOffer && window.desktop) {
      currentOffer = { ...descriptor.textureOffer, ticket };
      $('texture-offer-description').textContent = currentOffer.count + ' images in ' + currentOffer.folders.slice(0, 3).join(', ') + (currentOffer.folders.length > 3 ? ' and ' + (currentOffer.folders.length - 3) + ' more folders' : '') + '. Use matching images for missing maps?';
      $('texture-offer').hidden = false;
    }
  } catch (error) { if (ticket === sequence) message('Unable to open ' + descriptor.name + ': ' + error.message); }
  finally { if (ticket === sequence) setBusy(false); }
}
$('dismiss-found-textures').onclick = () => { currentOffer = null; $('texture-offer').hidden = true; };
$('use-found-textures').onclick = async () => {
  const offer = currentOffer; if (!offer || busy || offer.ticket !== sequence) return;
  currentOffer = null; $('texture-offer').hidden = true; setBusy(true, 'Applying textures…');
  try {
    const assets = await window.desktop.acceptTextures(offer.id);
    if (offer.ticket !== sequence) return;
    const result = await new TextureManager().apply(viewer.root, assets, { display: viewer.display, repair: true, flipY: viewer.root.userData.viewerTextureFlipY ?? true });
    tree.render(); materialPanel.render(); viewer.invalidate();
    message(result.applied ? 'Applied ' + result.applied + ' texture maps.' : 'No unambiguous texture matches. Existing materials were preserved.');
  } catch (error) { message('Unable to apply found textures: ' + error.message); }
  finally { setBusy(false); }
};

async function open(type) {
  if (busy) return;
  const family = typeof type === 'string' ? mediaType(type) : null;
  if (window.desktop) { setBusy(true); try { await load(await window.desktop.open(family?.id)); } catch (error) { setBusy(false); message(error.message); } }
  else { $('file-input').accept = family ? family.extensions.map(ext => '.' + ext).join(',') : allFileAccept; $('file-input').click(); }
}
async function home() {
  if (busy || !await canReplaceAudio() || !await canReplaceImage()) return;
  sequence++; currentOffer = null; $('texture-offer').hidden = true;
  media.activate(null); $('filename').textContent = ''; document.title = 'CationMedia'; message('');
}
async function files(list) {
  if (!list.length || busy) return;
  const dropped = [...list];
  const model = primaryDropFile(dropped, media.type?.id);
  const images = dropped.filter(file => isTexture(file.name));
  if (!model && !images.length) return message('Drop a 3D model, image, audio, or video file.');
  if (!model && media.type?.id !== 'model3d') return message('Open a 3D model before applying textures.');
  const assets = dropped.map(file => ({ name: file.name, file, url: URL.createObjectURL(file) }));
  setBusy(true); message('');
  try {
    if (model) {
      let descriptor;
      if (window.desktop) descriptor = await window.desktop.dropped(model);
      else {
        const extension = model.name.split('.').pop().toLowerCase();
        if (extension === 'blend') throw new Error('Open BLEND files in the desktop application with Blender installed.');
        descriptor = { name: model.name, extension, url: detectMediaType(model.name)?.id === 'image' ? assets.find(asset => asset.file === model).url : new URL(`__dropped__/${encodeURIComponent(model.name)}`, document.baseURI).href };
      }
      descriptor.assets = [...(descriptor.assets || []).filter(asset => !assets.some(drop => basename(drop.name) === basename(asset.name))), ...assets];
      await load(descriptor);
      return;
    }
    const root = viewer.root;
    const result = await new TextureManager().apply(root, assets.filter(asset => isTexture(asset.name)), {
      display: viewer.display, selected: tree.selected || root, explicit: true, flipY: root.userData.viewerTextureFlipY ?? true
    });
    if (result.applied) {
      document.querySelector('.modes button[data-mode="materials"]').click();
      viewer.invalidate();
      tree.render();
      $('status').textContent = `Applied ${result.applied} texture maps`;
    }
    message(result.applied ? (result.skipped ? `${result.skipped} files did not match a material. Use material names and map suffixes.` : '') : 'No matching material with UV coordinates. Select an object, or use matching material names.');
  } catch (error) { message(`Unable to apply textures: ${error.message}`); }
  finally { setBusy(false); for (const asset of assets) URL.revokeObjectURL(asset.url); }
}
$('open').onclick = open; $('file-input').onchange = event => { void files(event.target.files); event.target.value = ''; };
const fileDrop = new FileDropManager($('drop-overlay'), { busy: () => busy, files: (list, event) => media.type?.id === 'audio' && audio.timeline && [...list].every(file => ['audio', 'video'].includes(detectMediaType(file.name)?.id)) ? audio.timeline.drop(list, event) : files(list) });
document.querySelectorAll('.modes button[data-mode]').forEach(button => button.onclick = () => {
  if (!viewer.display.set(button.dataset.mode)) return message(button.dataset.mode === 'weights' ? 'This model has no skin weights or bones.' : 'This model has no vertex colors.');
  syncDisplayOptions(); viewer.invalidate();
});
$('weight-bone').onchange = event => { viewer.display.setWeightBone(event.target.value); viewer.invalidate(); };
$('show-bones').onchange = event => viewer.setBonesVisible(event.target.checked);
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => viewer.view(button.dataset.view));
$('fit').onclick = () => viewer.fit(); $('search').oninput = event => tree.filter(event.target.value);
$('show-all').onclick = () => { viewer.root.traverse(object => { object.visible = true; }); tree.render(); viewer.invalidate(); };
$('background').oninput = event => { viewer.scene.background.set(event.target.value); viewer.invalidate(); };
$('exposure').oninput = event => { viewer.renderer.toneMappingExposure = Number(event.target.value); $('exposure-value').value = Number(event.target.value).toFixed(1); viewer.invalidate(); };
$('grid').onchange = event => { viewer.grid.visible = event.target.checked; viewer.invalidate(); };
$('rotate').onchange = event => { viewer.controls.autoRotate = event.target.checked; viewer.invalidate(); };
$('clips').onchange = event => { viewer.animation.select(Number(event.target.value)); syncAnimation(); viewer.invalidate(); };
$('play').onclick = () => { viewer.animation.playing = !viewer.animation.playing; $('play').textContent = viewer.animation.playing ? 'Pause' : 'Play'; $('play').setAttribute('aria-label', `${viewer.animation.playing ? 'Pause' : 'Play'} animation`); viewer.invalidate(); };
$('seek').oninput = event => { viewer.animation.seek(Number(event.target.value)); viewer.invalidate(); updateTime(); };
$('speed').onchange = event => { viewer.animation.speed = Number(event.target.value); };
async function setBlender() { if (!window.desktop) return message('Blender integration is available in the desktop application.'); try { const path = await window.desktop.blender(); if (path) message(`Blender configured: ${path}`); } catch (error) { message(error.message); } }
$('close-defaults').onclick = () => $('defaults-dialog').close();
$('close-about').onclick = () => $('about-dialog').close();
$('open-default-settings').onclick = async () => { if (!window.desktop) return message('Windows Settings are available in the desktop application.'); try { await window.desktop.defaults(); } catch (error) { message(error.message); } };
async function demo() { if (busy || !await canReplaceAudio() || !await canReplaceImage()) return; sequence++; currentOffer = null; $('texture-offer').hidden = true; media.activate(mediaType('model3d')); const { root, clips } = createDemo(); install(root, clips, 'Demo scene'); message(''); }
async function command(action) {
  if (action.type === 'save-before-close') {
    const saved = !busy && !audioDecisionPending && await audio.saveChanges();
    return window.desktop.closeAfterAudioSave(Boolean(saved));
  }
  if (action.type === 'image-save-before-close') {
    let saved = false;
    try { saved = Boolean(!busy && await image.save()); } catch (error) { message(error.message); }
    return window.desktop.closeAfterImageSave(saved);
  }
  if (action.type === 'about') {
    if (!document.querySelector('dialog[open]')) $('about-dialog').showModal();
    return;
  }
  if (busy) return;
  const capability = { shade: 'shading', mode: 'shading', frame: 'camera', 'frame-selected': 'camera', view: 'camera', tool: 'transform', export: 'modelExport', 'export-meshes': 'modelExport', 'source-textures': 'textureExport', 'mesh-texture': 'textureExport', 'mesh-textures': 'textureExport' }[action.type];
  if (document.querySelector('dialog[open]')) return;
  if (capability && !hasCapability(media.type?.id, capability)) return;
  if (action.type === 'shade') {
    try { shading.apply(action.selected ? selection.selected : viewer.root, action.mode); updateStats(); viewer.invalidate(); } catch (error) { message(`Unable to change shading: ${error.message}`); }
    return;
  }
  if (action.type === 'open') return open();
  if (action.type === 'home') return home();
  if (action.type === 'audio' && media.type?.id === 'audio') return audio.command(action.action);
  if (action.type === 'video' && media.type?.id === 'video') return video.command(action.action || 'export');
  if (action.type === 'image' && media.type?.id === 'image') return image.command(action.action || 'save');
  if (action.type === 'demo') return demo();
  if (action.type === 'blender') return setBlender();
  if (action.type === 'defaults') return $('defaults-dialog').showModal();
  if (action.type === 'frame') return viewer.fit();
  if (action.type === 'frame-selected') return viewer.frameSelected(selection.selected);
  if (action.type === 'tool') return setTool(action.mode);
  if (action.type === 'view') { $('projection').textContent = viewer.viewKey(action.key); return; }
  if (action.type === 'mode') return document.querySelector(`.modes button[data-mode="${action.mode}"]`)?.click();
  if (action.type === 'source-textures') return saveSourceTextures();
  if (action.type === 'export-meshes') return saveSeparateMeshes(action.format);
  if (['mesh-texture', 'mesh-textures'].includes(action.type)) return convertMeshTextures(action);
  if (!['export', 'texture'].includes(action.type)) return;
  const selected = action.selected ? selection.selected : null;
  if (action.selected && !selected?.isMesh) return message('Select a mesh to export.');
  const wasPlaying = viewer.animation.playing; viewer.animation.playing = false;
  setBusy(true, 'Converting…'); message('');
  try {
    let data, name;
    if (action.type === 'texture') {
      const asset = await window.desktop.texture(); if (!asset) return;
      data = await exporter.texture(asset, action.format); name = asset.name;
    } else { data = await exporter.model(action.format, selected); name = selected?.name || $('filename').textContent; }
    const saved = await window.desktop.save({ data, format: action.format, name: selected?.name || name.replace(/\.[^.]+$/, '') });
    if (saved) message(`Saved ${saved}`);
  } catch (error) { message(`Unable to convert: ${error.message}`); }
  finally { setBusy(false); viewer.animation.playing = wasPlaying; viewer.invalidate(); }
}
async function saveSourceTextures() {
  if (!window.desktop || !exporter.sourceTextureCount()) return message('No original texture bytes are available for this model.');
  setBusy(true, 'Reading source textures…');
  try {
    const files = await exporter.sourceTextures();
    const saved = await window.desktop.saveSourceTextures({ files });
    if (saved) message(`Saved ${saved.count} texture byte streams to ${saved.folder}: ${saved.count - saved.embedded} source files, ${saved.embedded} embedded images extracted from the model.`);
  } catch (error) { message(`Unable to save source textures: ${error.message}`); }
  finally { setBusy(false); }
}
async function saveSeparateMeshes(format) {
  if (!window.desktop || !viewer.root) return;
  const meshes = exporter.meshes();
  if (!meshes.length) return message('This model contains no meshes.');
  const wasPlaying = viewer.animation.playing; viewer.animation.playing = false;
  setBusy(true, 'Exporting separate meshes…'); message('');
  try {
    const files = [];
    for (const [index, mesh] of meshes.entries()) files.push({ name: mesh.name || `Mesh ${index + 1}`, data: await exporter.model(format, mesh) });
    const saved = await window.desktop.saveMeshes({ format, files });
    if (saved) message(`Saved ${saved.count} separate meshes to ${saved.folder}`);
  } catch (error) { message(`Unable to export separate meshes: ${error.message}`); }
  finally { setBusy(false); viewer.animation.playing = wasPlaying; viewer.invalidate(); }
}
function setTool(mode) {
  if (!hasCapability(media.type?.id, 'transform')) return;
  transform.setMode(mode);
  document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === transform.mode)));
}
document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => { if (!busy) setTool(button.dataset.tool); });
async function convertMeshTextures(action) {
  const root = action.selected ? selection.selected : viewer.root;
  if (!root || !window.desktop || !hasCapability(media.type?.id, 'textureExport')) return;
  const entries = meshTextures(root, viewer.display).filter(entry => action.type === 'mesh-textures' || entry.id === action.textureId);
  if (!entries.length) return message('No textures available on this selection.');
  setBusy(true, 'Converting textures…');
  try {
    const files = [];
    for (const entry of entries) files.push({ name: entry.name, data: await encodeTexture(entry.texture, action.format) });
    if (action.type === 'mesh-textures') {
      const saved = await window.desktop.saveTextures({ files, format: action.format });
      if (saved) message('Saved ' + saved.count + ' textures to ' + saved.folder);
    } else {
      const saved = await window.desktop.save({ ...files[0], format: action.format });
      if (saved) message('Saved ' + saved);
    }
  } catch (error) { message('Unable to convert textures: ' + error.message); }
  finally { setBusy(false); viewer.invalidate(); }
}
window.addEventListener('keydown', event => {
  if (!window.desktop && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void open(); }
  if (media.type?.id === 'image' && (!busy || image.keyboardNavigationPending)) { image.key(event); return; }
  if (media.type?.id === 'audio' && !busy) { audio.key(event); return; }
  if (media.type?.id === 'video' && !busy) { video.key(event); return; }
  if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey || busy) return;
  if (!hasCapability(media.type?.id, 'camera')) return;
  if (event.code === 'NumpadDecimal' || event.code === 'NumpadComma') {
    event.preventDefault();
    if (selection.selected) viewer.frameSelected(selection.selected);
    return;
  }
  const key = /^(Digit|Numpad)[134567]$/.test(event.code) ? event.code.slice(-1) : event.key;
  if (['1', '3', '4', '5', '6', '7'].includes(key)) { event.preventDefault(); $('projection').textContent = viewer.viewKey(key); }
  if (event.key.toLowerCase() === 'f') viewer.fit();
  if (event.code === 'Space' && viewer.animation.clip) { event.preventDefault(); $('play').click(); }
});
media.activate(null); $('filename').textContent = ''; document.title = 'CationMedia'; syncAnimation();
if (window.desktop) { window.desktop.onOpen(load); window.desktop.onCommand(command); window.desktop.onImageFullscreen(fullscreen => { if (media.type?.id === 'image') image.onWindowFullscreen(fullscreen); }); void window.desktop.ready(); }
window.addEventListener('beforeunload', () => { fileDrop.dispose(); audio.timeline?.stop(); audio.dispose(); video.dispose(); image.dispose(); selection.dispose(); panels.dispose(); shading.restore(); transform.dispose(); viewer.dispose(); });

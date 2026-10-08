import { imageExportFormats } from './image.mjs';

const formatLabels = Object.freeze({ png: 'PNG', jpg: 'JPEG', webp: 'WebP', bmp: 'BMP', tiff: 'TIFF', gif: 'GIF still' });
const tools = Object.freeze([
  ['alpha-mask', 'Alpha mask'], ['atlas', 'Atlas'], ['auto-cutout', 'Auto cutout'],
  ['brightness', 'Brightness'], ['contrast', 'Contrast'],
  ['crop', 'Crop'], ['loop-texture', 'Loop texture'],
  ['flip-h', 'Mirror horizontally'], ['flip-v', 'Mirror vertically'],
  ['remove-grid', 'Remove checkerboard'], ['remove-color', 'Remove color'],
  ['resize', 'Resize'], ['rotate', 'Rotate…'], ['saturation', 'Saturation'], ['sharpness', 'Sharpness'],
  ['trim', 'Trim transparent']
]);

export function imageContextMenuTemplate(state = {}, command) {
  const context = ['stage', 'browser', 'file'].includes(state.context) ? state.context : 'stage';
  const editor = state.mode === 'editor';
  const hasImage = Boolean(state.hasImage);
  const hasBrowser = Boolean(state.hasBrowser);
  const editable = editor && hasImage;
  const item = (label, action, enabled = true, extra = {}) => ({ ...command(label, action), enabled, ...extra });

  if (context === 'file') {
    const isDirectory = Boolean(state.entry?.directory);
    return [
      item(isDirectory ? 'Open folder' : 'Open image', 'open-entry', hasBrowser),
      ...(!isDirectory ? [item('Select for atlas', 'select-entry', hasBrowser, { type: 'checkbox', checked: Boolean(state.entry?.selected) })] : []),
      { type: 'separator' },
      item('Copy name', 'copy-name', hasBrowser && Boolean(state.entry?.renamable)),
      item('Rename…', 'rename-entry', hasBrowser && Boolean(state.entry?.renamable)),
      { type: 'separator' },
      item('Go to parent folder', 'up', hasBrowser && Boolean(state.canUp)),
      item('This PC', 'locations'),
      item('Choose folder…', 'choose-folder')
    ];
  }

  if (context === 'browser') return [
    item('This PC', 'locations'),
    item('Choose folder…', 'choose-folder'),
    item('Go to parent folder', 'up', hasBrowser && Boolean(state.canUp)),
    { type: 'separator' },
    item('Select all images', 'select-all', hasBrowser && Number(state.imageCount) > 0),
    item(state.grid ? 'List view' : 'Thumbnail view', 'view', hasBrowser),
    { type: 'separator' },
    item('Atlas builder', 'tool:atlas', hasBrowser)
  ];

  return [
    item(editor ? 'Fullscreen viewer' : 'Edit image', editor ? 'mode:viewer' : 'mode:editor', hasImage),
    { type: 'separator' },
    { label: 'Tools', enabled: editable, submenu: tools.map(([id, label]) =>
      item(label, `tool:${id}`, editable, id === 'rotate' ? {} : { type: 'checkbox', checked: Boolean(state.activeTools?.includes(id)) })) },
    item('Pick background color', 'pick', editable),
    { type: 'separator' },
    item('Undo', 'undo', editor && hasImage && Boolean(state.undo)),
    item('Redo', 'redo', editor && hasImage && Boolean(state.redo)),
    item('Reset original', 'reset', editable),
    { type: 'separator' },
    ...(state.atlasReady ? [{ label: 'Save atlas as…', submenu: [
      item('PNG', 'save-atlas:png'), item('WebP', 'save-atlas:webp')
    ] }] : []),
    { label: 'Convert to…', enabled: hasImage, submenu: imageExportFormats.map(format =>
      item(formatLabels[format], `convert:${format}`, hasImage)) },
    item('Save', 'save', hasImage),
    item('Save as…', 'save-as', hasImage)
  ];
}

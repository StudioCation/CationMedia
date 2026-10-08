import mask from '@tabler/icons/outline/mask.svg?raw';
import atlas from '@tabler/icons/outline/layout-grid.svg?raw';
import wand from '@tabler/icons/outline/wand.svg?raw';
import brightness from '@tabler/icons/outline/brightness.svg?raw';
import contrast from '@tabler/icons/outline/contrast.svg?raw';
import crop from '@tabler/icons/outline/crop.svg?raw';
import flipHorizontal from '@tabler/icons/outline/flip-horizontal.svg?raw';
import flipVertical from '@tabler/icons/outline/flip-vertical.svg?raw';
import loopTexture from '@tabler/icons/outline/repeat.svg?raw';
import removeGrid from '@tabler/icons/outline/layout-grid-remove.svg?raw';
import removeColor from '@tabler/icons/outline/eraser.svg?raw';
import reset from '@tabler/icons/outline/restore.svg?raw';
import resize from '@tabler/icons/outline/resize.svg?raw';
import rotate from '@tabler/icons/outline/rotate.svg?raw';
import saturation from '@tabler/icons/outline/color-filter.svg?raw';
import sharpness from '@tabler/icons/outline/adjustments-horizontal.svg?raw';
import trim from '@tabler/icons/outline/scissors.svg?raw';
import folder from '@tabler/icons/outline/folder.svg?raw';
import folderOpen from '@tabler/icons/outline/folder-open.svg?raw';
import computer from '@tabler/icons/outline/device-desktop.svg?raw';
import drive from '@tabler/icons/outline/database.svg?raw';
import home from '@tabler/icons/outline/home.svg?raw';
import documents from '@tabler/icons/outline/file-text.svg?raw';
import pictures from '@tabler/icons/outline/photo.svg?raw';
import downloads from '@tabler/icons/outline/download.svg?raw';
import music from '@tabler/icons/outline/music.svg?raw';
import videos from '@tabler/icons/outline/video.svg?raw';
import grid from '@tabler/icons/outline/layout-grid.svg?raw';
import list from '@tabler/icons/outline/list.svg?raw';
import save from '@tabler/icons/outline/device-floppy.svg?raw';
import saveAs from '@tabler/icons/outline/file-export.svg?raw';
import history from '@tabler/icons/outline/history.svg?raw';
import undo from '@tabler/icons/outline/arrow-back-up.svg?raw';
import redo from '@tabler/icons/outline/arrow-forward-up.svg?raw';
import check from '@tabler/icons/outline/check.svg?raw';

export const imageToolDefinitions = Object.freeze([
  ['alpha-mask', 'Alpha mask', mask],
  ['atlas', 'Atlas', atlas],
  ['auto-cutout', 'Auto cutout', wand],
  ['brightness', 'Brightness', brightness],
  ['contrast', 'Contrast', contrast],
  ['crop', 'Crop', crop],
  ['flip-h', 'Flip horizontal', flipHorizontal],
  ['flip-v', 'Flip vertical', flipVertical],
  ['loop-texture', 'Loop texture', loopTexture],
  ['remove-grid', 'Remove checkerboard', removeGrid],
  ['remove-color', 'Remove color', removeColor],
  ['resize', 'Resize', resize],
  ['rotate', 'Rotate', rotate],
  ['saturation', 'Saturation', saturation],
  ['sharpness', 'Sharpness', sharpness],
  ['trim', 'Trim transparent', trim]
]);

export const imageUiIcons = Object.freeze({ folder, folderOpen, computer, drive, home, desktop: computer, documents, pictures, downloads, music, videos, grid, list, save, saveAs, history, undo, redo, reset, check });
export const imageIcon = svg => svg.replace('<svg', '<svg aria-hidden="true" focusable="false"');

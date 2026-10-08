import { hasCapability } from './mediaTypes.mjs';
import { imageExportFormats } from './image.mjs';

const imageFormatLabels = Object.freeze({ png: 'PNG', jpg: 'JPEG', webp: 'WebP', bmp: 'BMP', tiff: 'TIFF', gif: 'GIF still' });

export function mediaMenuTemplate(id, command, version = '') {
    const views = [];
    if (hasCapability(id, 'camera')) views.push(command('Frame model', { type: 'frame' }, 'F'), command('Frame selected', { type: 'frame-selected' }, 'numdec'),
      ...[['Orbit left', '4'], ['Orbit right', '6'], ['Perspective / orthographic', '5'], ['Top', '7'], ['Front', '1'], ['Right', '3']].map(([label, key]) => command(label, { type: 'view', key }, key)), { type: 'separator' });
    if (hasCapability(id, 'shading')) views.push(...['materials', 'solid', 'wire', 'normals', 'vertex', 'weights'].map(mode => command({ materials: 'Materials', solid: 'Solid', wire: 'Wireframe', normals: 'Normals', vertex: 'Vertex colors', weights: 'Bone weights' }[mode], { type: 'mode', mode })), { type: 'separator' });
    if (hasCapability(id, 'transform')) views.push(...[['select', 'Select'], ['translate', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']].map(([mode, label]) => command(label, { type: 'tool', mode })), { type: 'separator' });
    if (hasCapability(id, 'video')) views.push(command('Video settings', { type: 'video', action: 'settings' }), command('Visual crop', { type: 'video', action: 'crop' }), { type: 'separator' });
    views.push({ role: 'togglefullscreen' });
    const open = command('Open…', { type: 'open' }, 'CmdOrCtrl+O'); open.registerAccelerator = true;
    const settings = [command('Default apps…', { type: 'defaults' })];
    const audio = hasCapability(id, 'audio');
    const video = hasCapability(id, 'video');
    const image = hasCapability(id, 'image');
    if (hasCapability(id, 'scene')) settings.unshift(command('Set Blender path…', { type: 'blender' }));
    return [
      { label: 'File', submenu: [command('Home', { type: 'home' }), open, ...(video ? [command('Export video…', { type: 'video' }, 'CmdOrCtrl+S')] : []), ...(audio ? [command('Save', { type: 'audio', action: 'save' }, 'CmdOrCtrl+S'), command('Save as / Convert…', { type: 'audio', action: 'export' }, 'CmdOrCtrl+Shift+S')] : []), ...(image ? [command('Save image', { type: 'image', action: 'save' }, 'CmdOrCtrl+S'), command('Save image as…', { type: 'image', action: 'save-as' }, 'CmdOrCtrl+Shift+S'), { label: 'Convert image to…', submenu: imageExportFormats.map(format => command(imageFormatLabels[format], { type: 'image', action: `convert:${format}` })) }] : []), { type: 'separator' }, ...(!id || hasCapability(id, 'scene') ? [command('Load 3D demo', { type: 'demo' })] : []), { role: 'quit' }] },
      ...(image ? [{ label: 'Edit', submenu: [['Undo', 'undo', 'CmdOrCtrl+Z'], ['Redo', 'redo', 'CmdOrCtrl+Y'], ['Crop', 'crop'], ['Rotate…', 'rotate'], ['Trim transparent', 'trim']].map(([label, action, key]) => command(label, { type: 'image', action }, key)) }] : []),
      ...(video ? [{ label: 'Playback', submenu: [['Play / Pause', 'play', 'Space'], ['Stop', 'stop', 'Esc'], ['Loop', 'loop', 'L']].map(([label, action, key]) => command(label, { type: 'video', action }, key)) }] : []),
      ...(audio ? [
        { label: 'Edit', submenu: [['Undo', 'undo', 'CmdOrCtrl+Z'], ['Redo', 'redo', 'CmdOrCtrl+Y'], ['Select all', 'all', 'CmdOrCtrl+A'], ['Clear selection', 'clear'], ['Trim to selection', 'trim'], ['Delete selection', 'delete'], ['Reverse', 'reverse']].map(([label, action, key]) => command(label, { type: 'audio', action }, key)) },
        { label: 'Effects', submenu: [['Volume…', 'gain'], ['Pitch…', 'pitch'], ['Time stretch…', 'stretch'], ['Fade in…', 'fade-in'], ['Fade out…', 'fade-out'], ['Chorus…', 'chorus'], ['Distortion…', 'distortion'], ['Smoothness…', 'smooth']].map(([label, effect]) => command(label, { type: 'audio', action: `effect:${effect}` })) },
        { label: 'Playback', submenu: [['Play / Pause', 'play', 'Space'], ['Stop', 'stop'], ['Loop', 'loop', 'L'], ['Set in', 'in', 'I'], ['Set out', 'out', 'O'], ['Find loop regions', 'find-loops']].map(([label, action, key]) => command(label, { type: 'audio', action }, key)) }
      ] : []),
      { label: 'View', submenu: views }, { label: 'Settings', submenu: settings }, { label: 'Help', submenu: [command(`About CationMedia${version ? ` ${version}` : ''}…`, { type: 'about' })] }
    ];
}

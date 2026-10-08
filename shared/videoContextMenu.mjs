import { videoProfiles } from './video.mjs';
import { audioFormats } from './mediaTypes.mjs';

export function videoContextMenuTemplate(state, command) {
  return [
    command('Play / Pause', 'play'), command('Stop', 'stop'),
    { ...command('Loop', 'loop'), type: 'checkbox', checked: Boolean(state.loop) },
    { type: 'separator' }, command('Video settings', 'settings'), command('Visual crop', 'crop'),
    { label: 'Convert To…', submenu: [
      { label: 'Video', submenu: Object.entries(videoProfiles).map(([format, profile]) => command(profile.label, `export:${format}`)) },
      { label: 'Audio', enabled: state.hasAudio !== false, submenu: audioFormats.map(format => command(format.toUpperCase(), `audio:${format}`)) }
    ] },
    command('Save frame as PNG…', 'frame'), command('Export video…', 'export')
  ];
}

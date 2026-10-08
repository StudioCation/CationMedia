import { decodeWave, fadeSelection } from '../../shared/audio.mjs';
import { buildPeaks } from '../../shared/audioPeaks.mjs';
self.onmessage = ({ data }) => {
  try {
    if (data.fade) {
      const channels = fadeSelection(data.channels, data.fade);
      self.postMessage({ channels }, channels.map(channel => channel.buffer)); return;
    }
    const result = data.data ? decodeWave(data.data) : { channels: data.channels, sampleRate: data.sampleRate };
    const peaks = buildPeaks(result.channels);
    const transfers = peaks.flatMap(levels => levels.flatMap(level => [level.min.buffer, level.max.buffer]));
    if (data.data) transfers.push(...result.channels.map(channel => channel.buffer));
    self.postMessage({ ...(data.data ? result : {}), peaks }, transfers);
  } catch (error) { self.postMessage({ error: error.message }); }
};

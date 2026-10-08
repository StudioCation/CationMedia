import { mixClips } from '../../shared/audioMix.mjs';
self.onmessage = ({ data }) => {
  try { const result = mixClips(data.clips, data.sampleRate); self.postMessage(result, result.channels.map(c => c.buffer)); }
  catch (error) { self.postMessage({ error: error.message }); }
};

import { analyzeMusicalLoops } from '../../shared/audioLoopAnalysis.mjs';
self.onmessage = event => {
  try { const { channels, sampleRate, range } = event.data; self.postMessage(analyzeMusicalLoops(channels, sampleRate, ...range)); }
  catch (error) { self.postMessage({ error: error.message }); }
};

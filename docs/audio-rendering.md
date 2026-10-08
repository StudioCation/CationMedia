# Audio waveform rendering

Waveform painting uses the min/max pyramid and one closed silhouette per channel.
Do not replace the silhouette with a path containing one tall stroke per pixel:
on the Windows GPU backend that representation caused severe raster/compositor
stalls despite sub-millisecond JavaScript preparation. Loop highlighting reuses
the silhouette with a clipped fill; the selection overlay remains independent.
Loop buttons are retained between navigation frames instead of rebuilding the DOM.

`tests/audio-wheel-performance.mjs` compares the same real file, viewport and GPU
configuration across installed/source builds. Set `AUDIO_TEST_FILE` to the fixture,
`VIEWER_EXECUTABLE` for an installed build, `AUDIO_BASELINE=1` for baseline capture,
and `AUDIO_NATIVE_WHEEL=1` to exercise a long sequence of actual browser wheel input.
The default sequence dispatches one wheel update per animation frame. The test
records paint preparation, requestAnimationFrame intervals and input-to-next-frame
latency separately. These are browser timing measurements, not physical display
latency measurements. Background throttling is disabled only in the test fixture.

On the countdown stereo MP3 at a 1703 x 924 physical-pixel canvas (DPR 1.25), the
matched short sequence showed baseline frame p95 about 929 ms without playback
and 704 ms with loop playback. The filled-silhouette implementation measured
4.2 ms and 8.4 ms respectively. The native 160-event sequence measured frame p95
4.3 ms / 12.5 ms, with paint preparation p95 0.6 ms / 1.1 ms.
Raw local results are written under `artifacts/audio/wheel-*.json`.

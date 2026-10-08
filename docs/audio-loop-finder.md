# Musical loop finder

`shared/audioLoopAnalysis.mjs` runs in the existing audio worker. It does not modify
samples or hide a bad boundary with a crossfade.

1. A 1024-point STFT on reduced-rate audio produces spectral bands, chroma, level
   and positive spectral novelty. Channel powers are combined without cancelling
   opposite-phase stereo.
2. Overlapping local windows estimate a 65–185 BPM pulse from novelty
   autocorrelation. Fractional-frame beat spacing is fitted to observed attacks;
   low-support or irregular grids are rejected. A 28-second pass is supplemented
   by 20- and 14-second windows at four-second intervals, recovering stable
   sections next to fills and arrangement changes. Spectral features are reused.
   Long-window results take priority so added passes preserve established loops.
3. Accent and timbre recurrence estimate three- or four-beat bar groupings.
   Candidates contain 1, 2, 4 or 8 whole bars, at most 20 seconds. The preferred
   8–12 seconds never takes precedence over musical duration.
4. Both sides of a boundary must match in spectrum, chroma and loudness. An
   adjacent occurrence must also support recurrence of the complete phrase.
5. Original-rate waveform matching refines the endpoint within 25 ms. A shared
   shift of up to 8 ms minimizes the level/slope discontinuity. Each channel must
   pass independently; mismatched stereo cannot be hidden by channel averaging.
   If musical phrases match but waveform windows differ (noise, reverb, mixing),
   refine the join directly: a shared move up to 20 ms and a duration adjustment
   of at most 5 ms / 1.5% of one beat. Every channel must meet the level/slope
   continuity limits. A 50 ms waveform mismatch alone is not a rejection.
6. Results do not overlap. Near-identical copies, circular bar rotations and
   duplicated phrase lengths are removed using a stricter identity criterion
   than musical compatibility (40% of its distance limits). Interpolated feature
   frames avoid false differences caused by sub-frame boundary shifts, including
   MP3 encoding. Similar rhythm and harmony alone do not make arrangements duplicates.
7. Windows without a reliable beat grid get a phrase-recurrence pass. It uses the
   supported track tempo/meter, searches nearby whole-bar durations and requires
   onset-pattern correlation of at least 0.6 across repeated phrases. A dense
   96-point phrase comparison checks harmony, timbre and level; a 50 ms context
   must pass the ordinary boundary thresholds, followed by the same stereo sample
   refinement. This supports syncopation without requiring an attack on every beat.
   Established loops retain priority; recovered phrases use their first valid
   occurrence. Overlapping candidates do not consume the sample-refinement budget.

The tooltip reports estimated BPM, bar grouping and measured join level error (relative to local RMS).
These are measurements and heuristic estimates, not calibrated confidence or a
guarantee of perceptual perfection. Irregular meters, weak beats, tempo drift,
non-repeating vocals and evolving textures may return no results. The finder
deliberately has no zero-crossing-only fallback. At least six seconds is required.

Validation uses independent synthesized drum/chord phrases at 90, 100, 120 and
137 BPM, three/four-beat bars, offset attacks, MP3 encoding and opposite-phase
stereo. Negative cases cover silence, stationary tones, noise and an incompatible
second channel, plus repeating phrases with independent stereo ambience. UI tests cover worker results, loop locking and highlight reset.
An arrangement-variation fixture verifies both retained timbres and deduplication.
With `AUDIO_TEST_FILE` pointing to `fluxsound-action-countdown-526491.mp3`, the
real-track regression checks five or more disjoint results, including the
7.72–14.57 s syncopated phrase, stereo join limits and sample-accurate preservation
of the confirmed 80.152–87.006 s loop.

Algorithm references:
- [AudioLabs FMP: spectral novelty](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S1_NoveltySpectral.html)
- [AudioLabs FMP: autocorrelation tempogram](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S2_TempogramAutocorrelation.html)
- [AudioLabs FMP: music self-similarity](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S2_SSM.html)

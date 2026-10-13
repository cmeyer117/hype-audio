# Speeches audio pipeline

How the five historic Speeches clips are produced (all local, zero cost except the free, unofficial Edge TTS endpoint).

1. `hist-speeches.json`: the speeches (public-domain text), split into spoken lines, with `reflect` flag. Its per-speech `voice`/`speed` fields apply only to the Kokoro renderer (`render-hist.mjs`); `render_edge.py` has its own `VOICE` map and rate/pitch.
2. Voice: `render_edge.py [n ...]` renders with Edge neural TTS (`pip install edge-tts`; voice `en-GB-RyanNeural`; charge = rate -8% / pitch -3Hz, reflect = -12% / -2Hz, controlled pauses between lines). Earlier Kokoro version: `render-hist.mjs` (kokoro-js, voices bm_george/bm_fable/am_fenrir).
3. Bed: `make_bed.py <out.wav> <seconds> <intense|dark>` synthesizes a sub drone + dark pad + 66 BPM war drums + risers (intense) or the drumless version (dark). Charge speeches use intense, reflect use dark.
4. Mix: `mix_hist.py` (ffmpeg: EQ, compressor, sidechain-ducked bed, loudnorm -16 LUFS) writes `speeches-hist/speech-N.mp3`.
5. Publish: `push_speeches.py <dir> <id-prefix> --apply` uploads to the `hype-audio` bucket and appends clips (pillar `speeches`, `delivery_role: motivational_speech`, `source_type: original`, blank `moment`) with a compare-and-swap on `app_state.updated_at`. `tombstone_ids.py <ids...> --apply` soft-deletes superseded clips.

Use a NEW id prefix for every re-render: the service worker caches clip files by URL, so reusing an id keeps playing the old audio on devices.

Scripts expect to run from a native `C:\` folder (not the Drive path) and read the service-role key from `C:\Users\gregm\jarvis-embed\.env`; no secret is stored here. Voice and mix history (Kokoro, Edge William, Edge Ryan) is archived in `Claude Outputs/speeches-voice-history/`.

**Current voice (2026-10-13): Kokoro `bm_george` + enhancement**, Carl's pick: `node render-george.mjs` (all five, keeps wavs), `python -I enhance_voice.py <wav dir> <out dir>` (EQ-match FIR from `bm_george-eq-curve.json`, then highpass, afftdn, compressor, exciter), then `mix_hist.py` and `push_speeches.py`. The Edge Ryan path (`render_edge.py`) stays as the alternative. Full write-up: vault note `10 - AI & Tech Knowledge/Voices in Apps - Kokoro, Edge TTS and Enhancement.md`.

Live ids (2026-10-13): `clip_speeches_hist4_1..5` (George, enhanced). Superseded: `hist` (Kokoro mixed voices), `hist2`/`hist3` (Edge Ryan), all tombstoned.

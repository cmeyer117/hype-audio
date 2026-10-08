# Hype Own Cue Studio, phase 1: non-destructive trim + an exercise on your own clips

Date: 2026-10-08. Status: scope approved by Carl in brainstorming ("non-destructive trim + attach to an exercise"); this document is phase 1, inside the Hype app.
Source: Codex outlook item H2 ("record, trim, label a short cue in Carl's voice; keep the original; attach to an exercise or pack").

## What already exists (do not rebuild)
"Record Your Own" (spec 2026-07-27): in the Carl pillar's section view you can record, preview, re-record and save a clip with Title, Mentality, Moment, Source, Use case and Delivery role (including "Instructional cue"). Saved clips are `pillar: 'carl'` rows in the `hype_audio` array (localStorage, synced by CAS), the audio file is in Supabase Storage.

## What is missing
1. **Trim.** A rant has dead air at both ends; there is no way to cut it, and re-recording loses the take.
2. **An exercise.** A cue cannot be tied to "Bench Press" or "Hack Squat".

## Facts that shape the design (read 2026-10-08)
- `playSingle(clip)` in `hype-audio.js` creates `new Audio(clip.storage_url)`, counts a play on the real `onplay`, advances on `onended`. Every playback path (single, queue, random loop, repeat, mid-set, PR rant, state modes) goes through it, so trim applies in one place.
- `pickMidSetClip()` / `playMidSetHype()` is what the gym page calls today, with no arguments.
- **Row and Vessel carry hand-synced copies of `hype-audio.js`** (Row's is 947 lines, the canonical file 1,032: it has drifted, and its `playMidSetHype()` call site is in `gym.html`). Row and Vessel deploy to production on push. So nothing built here reaches the gym floor until a deliberate phase 2.
- Tests in this repo are plain node self-checks (`node hype-audio.selfcheck.js`), with a minimal `Audio` shim.

## Design

### Data (metadata only, the original file is never touched)
New optional clip fields, written with the existing `updateClip` (so they sync like every other field):
- `trim_start`: seconds (finite, `>= 0`), default absent = 0.
- `trim_end`: seconds (finite, `> trim_start`), absent = play to the end.
- `exercise`: a normalised exercise name: lowercase, letters/digits/spaces/hyphens only, whitespace collapsed, at most 60 characters; absent = a general cue.
Clearing a trim removes the fields; the untrimmed original is therefore always one tap away.

### Playback (`hype-audio.js`, one place: `playSingle`)
`normalizeTrim(clip, duration)` (pure) returns `{ start, end }` or `null` when there is no usable trim: values must be finite numbers, `start >= 0`, `end > start + 0.5`, clamped to the real duration (a trim beyond the file is ignored). When a trim applies:
- on `loadedmetadata` (or immediately when metadata is already available) the audio seeks to `start`; before metadata the seek is not attempted, so a browser that ignores an early `currentTime` still starts at the right place;
- on `timeupdate`, once `currentTime >= end` the audio is paused and the normal end-of-clip path runs exactly once (the same `advance()` as a natural end), guarded so a late `timeupdate` or the natural `ended` cannot fire it twice.
`play_count`, events, media-session metadata and error handling are unchanged. A clip with no trim behaves byte-for-byte as before.

### Exercise preference (`hype-audio.js`)
`normalizeExerciseName(s)` (pure) as above. `pickMidSetClip(exercise)` and `playMidSetHype(exercise)` take an OPTIONAL exercise: when given, and at least one eligible clip in the mid-set pool has the same `exercise`, the pick is made from those clips only (still through the existing cooldown / no-repeat filter); otherwise it falls back to the current pool exactly as today. Called with no argument (the gym page today) it is unchanged.

### Cue editor (`index.html`)
One shared builder, `buildCueEditor({ src, initial })`, used in two places:
- the Record flow's save form (after the preview): an **Exercise** text field (optional, with a `datalist` of the exercises already used on your clips) and **Trim**: two range sliders over the clip's real duration with a readout ("0:03 to 0:21 of 0:25"), a **Play trimmed** button that plays exactly the trimmed window, and **Reset trim**;
- an **Edit cue** control on your own (Carl pillar) clips in the section view: the same editor over the saved clip, saving only `trim_start`, `trim_end` and `exercise` through `updateClip`.
Everything is keyboard-operable with real labels; the readout is a polite live region. Nothing here uploads audio: a trim is two numbers.

## Out of scope for phase 1 (decided)
- **Phase 2, needs Carl's explicit go because Row and Vessel deploy to production:** re-sync `hype-audio.js` into Row (and Vessel), and pass the current exercise from `gym.html`'s set-logging call (`playMidSetHype(exerciseName)`). Until then trim and exercise preference only affect playback inside the Hype app.
- Destructive trimming or re-encoding; packs; waveform display; AI of any kind.

## Tests (node self-checks, extending `hype-audio.selfcheck.js`)
- `normalizeTrim`: valid window; start only; end only; start >= end ignored; shorter than 0.5 s ignored; beyond the duration clamped or ignored; NaN, strings, negatives ignored; no clip fields returns null.
- `normalizeExerciseName`: case, punctuation, whitespace, length cap, empty to null.
- Playback with a fake `Audio` that can fire `loadedmetadata`, `timeupdate` and `ended`: seeks to `start` only after metadata; stops and advances once at `end` (and a later `ended` does not advance again); a clip without trim never sets `currentTime`; `play_count` still counts once.
- `pickMidSetClip(exercise)`: prefers matching clips, respects cooldown, falls back to the whole pool when none match, unchanged with no argument.
- `updateClip` persists and clears trim fields; the original `storage_url` is never modified.
- `index-a11y.selfcheck.js` keeps passing for the new controls (labels, no duplicate ids).
- Browser pass on the real page with the Supabase and auth layers stubbed and a synthetic audio file: record-less path (an existing own clip's Edit cue), trim readout, Play trimmed stops at the end, save, the field survives a reload.
- Not verifiable here: real iOS home-screen playback of a seeked clip (Carl, on the phone).

## Codex spec review (luna, 2026-10-08): folded in
- **Restart honours the trim.** The media-session "restart" and the "previous track within 3 s" threshold used the raw file time. `restartCurrent()` seeks to the trim start (0 for an untrimmed clip) and `secondsIntoCurrent()` measures from it.
- **The editor's preview is its own element.** `HypeAudio.watchTrim(audio, clipLike, onEnd)` is the one trim implementation (seek on metadata, pause and call `onEnd` once at the end); `playSingle` uses it with the queue's finish, the editor uses it on its own `<audio>` with no queue involvement. A shared once-only `finish()` keeps the natural `ended` and a trim end from advancing twice.
- **Hostile synced data.** `exercise` is normalised on write (`setClipCue`) and AGAIN at the match boundary (`pickRandom`), so a stored value that was never normalised still matches and a non-string or markup value can only ever compare as plain letters, digits, spaces and hyphens. The editor sets values with `.value` / `textContent`, never HTML interpolation.
- **Accessibility.** Each slider has an accessible name, `min`/`max`/`step` (0.1 s), and one polite live readout that updates when either moves; the per-clip editor has visible, keyboard-operable Save and Cancel.
- **Accepted limits (single-user app, documented):** sync merges clips whole-object last-write-wins (`sync.js`), so `exercise` edited on one device and a trim on another is resolved by the later `updated_at` (the three cue fields are written together as one unit, `setClipCue`); a stale older copy of the file (Row/Vessel, until phase 2) read-modify-writes the whole clip so it preserves the new fields, but a device that never loaded them and writes an older whole clip after a newer edit can drop them.

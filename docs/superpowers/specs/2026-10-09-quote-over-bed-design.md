# Hype quote-over-bed, phase 3a: a quote clip plays over a background bed

Date: 2026-10-09. Status: design approved by Carl in brainstorming (own listening only; auto-pair with optional pin; files first, text-to-speech later; mixer in Hype first). This document is phase 3a, inside the Hype app only. 3b (text-to-speech quotes) and 3c (copy into Row and Vessel) are separate.
Source: Carl's idea, 2026-10-08: "pull some of the coolest quotes and speeches from my favorite animes or my favorite quotes in general and play them over some of the cool background audio we have saved".

## What already exists (do not rebuild)
- `delivery_role` on a clip already has `music`, `instrumental`, `noise` (these are the beds) and `motivational_speech` (the quotes). `source_type` already has `personal_use` ("Personal use only"). No new clip types.
- `playSingle(clip)` in `hype-audio.js` is the one place a clip starts. `stopPlayback()` and `togglePlay()` pause or end `currentAudio`. Own Cue Studio (phase 1) already trims a clip with `trim_start` / `trim_end`.
- Supabase Storage answers cross-origin requests with `Access-Control-Allow-Origin: *` (checked 2026-10-09), and `sw.js` caches clip files.

## Design

### Which clips are quotes and beds
- A **quote** is a clip with `delivery_role === 'motivational_speech'`. A **bed** is a clip with `delivery_role` in `music`, `instrumental`, `noise`. Neither role is a new field.
- New optional clip field `bed_id`: the id of a bed pinned to this quote. Written with `updateClip`, synced like every other field. It is normalised on read: it must be a string that matches an existing, non-deleted bed, otherwise it is ignored.

### Picking the bed (pure, in `hype-audio.js`: `pickBedFor(quote)`)
1. The pinned `bed_id`, when it resolves to an active bed.
2. Otherwise a random bed with the same `pillar` and `mentality` as the quote.
3. Otherwise a random bed with the same `pillar`.
4. Otherwise none: the quote plays alone, exactly as today.
The bed is never the "current" clip, never enters the queue, never advances anything, never increments `play_count` and never writes a play event.

### Setting
`localStorage` key `hype_quote_bed` (`'1'` default on / `'0'` off), a per-device preference like the other playback toggles. Exposed as `HypeAudio.getQuoteBed()` / `setQuoteBed(on)`; one switch in the existing settings area of `index.html`.

### Mixing (new `quote-bed.js`, loaded before `hype-audio.js`)
- Only the **bed** is routed through WebAudio (`createMediaElementSource` into a `GainNode`), because iPhone Safari ignores `audio.volume`. The **quote** keeps playing on its own plain `Audio` element at full volume, untouched. If the bed's cross-origin route is silent or fails, the worst case is "no bed"; the quote is never affected.
- The bed `Audio` is created with `crossOrigin = 'anonymous'`, `loop = true`, and goes through a gain envelope: start at 0, ramp to the **bed level 0.45** over 0.8 s, **duck to 0.18** when the quote's voice starts, **swell back to 0.45** when the quote ends, then fade to 0 over 1.2 s and stop. The bed starts 1.2 s before the quote's voice.
- The `AudioContext` is created lazily on the first quote start (that tap is the user gesture iOS requires) and reused. If `AudioContext` is missing, or `resume()` rejects, or the bed `Audio` fires `error`, the bed is dropped silently and the quote continues.
- Lifecycle is bound to the quote's own `Audio` element, not to timers: quote `play` starts or resumes the bed, quote `pause` pauses it, quote `ended`, a trim end, a new `playSingle`, `stopPlayback()` or the clip being replaced stops it. Every stop is idempotent. There is at most one bed at a time; starting a new quote stops the previous bed first.
- `playSingle` calls `QuoteBed.attach({ quoteAudio, bed, quoteClip })` right after creating the quote element, and `stopPlayback()` / the top of `playSingle` call `QuoteBed.stop()`. Nothing else in the playback code changes, so queue, repeat, media session, the mini-player and the trim end (`finish()`) behave exactly as today. The trim end already pauses the quote and calls `finish`; because the bed is bound to the quote's `pause` event it stops there too.

### Editing (index.html)
- The "Edit cue" menu on a quote clip gets a **Background** field: a select listing the beds (grouped by pillar) plus "Auto". Saving writes `bed_id` (or removes it for "Auto") via `HypeAudio.setClipBed(id, bedId)` (validates and normalises like `setClipCue`; a `bed_id` for a clip that is not a bed is dropped).
- A quote row shows "· over <bed title>" in its meta when pinned. All text is set with `textContent`; the bed title is synced data and is never put into an attribute selector or markup.

## Failure modes handled
- No bed in the library, bed deleted, `bed_id` pointing at a non-bed: quote plays alone.
- Bed file cannot be fetched (offline, CORS, 404): bed is dropped on `error`; quote plays.
- Quote paused by the user, an assistant, or the lock screen: bed pauses with it; quote resumed: bed resumes.
- Rapid next/previous: each `playSingle` stops the previous bed first, and stale handlers are guarded by comparing against the current quote element, like `finish()` does.
- `AudioContext` suspended by the browser: `resume()` is attempted on each attach; failure drops the bed.

## Accepted limits (3a)
- The bed starts from the beginning each time (looping); no beat matching.
- Bed level and duck level are constants (0.45 / 0.18), not user settings, until Carl asks for a slider.
- Row and Vessel do not get this until phase 3c (they would play the quote alone, as today).
- Text-to-speech quote creation is phase 3b.
- Anime/other copyrighted audio is allowed only as a private clip (`source_type: personal_use`); nothing in this feature exports, records or shares audio.

## Tests (plain node self-checks, `quote-bed.selfcheck.js`, FakeAudio + FakeAudioContext shim)
1. `pickBedFor`: pin wins; falls back to pillar+mentality, then pillar, then none; a deleted or non-bed pin is ignored; a hostile `bed_id` (markup, non-string) is ignored.
2. A quote with a bed starts the bed gain ramp, ducks on voice start, swells and fades on quote end; quote `pause` pauses the bed and `play` resumes it.
3. `stopPlayback`, a new `playSingle`, and a trim end each stop the bed once (idempotent), never twice, and never leave two beds.
4. The bed never changes `currentClipId`, the queue, `play_count`, or the recent-played window.
5. Setting off, no beds, missing `AudioContext`, `resume()` rejecting, and bed `error` all leave the quote playing normally.
6. `setClipBed` stores or clears `bed_id` as one unit and leaves the audio file and `storage_url` untouched; all existing self-checks still pass.

## Verification beyond tests
- Browser pane: real page scripts with stubbed auth/sync, a synthetic 440 Hz quote and a synthetic noise bed from a static server with Range support; check bed gain values over time, the Edit cue Background field, and that the quote element is never given a `crossOrigin`.
- **A real stored clip on a real phone** is the only proof the cross-origin route is audible on iOS; that check is Carl's (play a quote with a bed and listen).

## Tasks
1. `quote-bed.js` (pure envelope math + the attach/stop controller) + `quote-bed.selfcheck.js` (tests 2, 3, 5).
2. `hype-audio.js`: `pickBedFor`, `setClipBed`, `getQuoteBed` / `setQuoteBed`, the two call sites in `playSingle` / `stopPlayback` (tests 1, 4, 6).
3. `index.html`: settings switch, Edit cue Background select, meta text; script tag order; service-worker shell list if it lists scripts.
4. Browser verification, Codex review of the diff, inline `/code-review`, push, handoff.

# Gym-Proof Playback — Media Session + PWA Offline

**Status:** Approved, ready for planning
**Date:** 2026-07-26

## Problem

Hype Audio is a phone-in-pocket app in theory but not in practice: there are no lock-screen controls (every skip/pause means pulling the phone out and unlocking it), no offline support (gym dead zones with no signal break playback), and it isn't installable to the home screen.

## Goal

Phone stays in the pocket during a workout. Lock-screen shows the current clip with working play/pause/skip. Clips you've already played work offline even with zero signal. The app installs to the home screen like a native app.

## Non-goals

- No changes to existing playback logic in `hype-audio.js` (queue/randomFilter/repeatClip modes stay as-is) — this only adds Media Session wiring and caching around them.
- No eager "download everything" or manual per-pillar download UI.
- No cache eviction/size cap — clip library is small enough (~150 short audio files) that unbounded cache-as-played growth is a non-issue.

## Architecture

Three additive pieces, no changes to existing playback logic:

### 1. `manifest.json`

PWA manifest, linked from `index.html` `<head>`.

- `name`: "Hype Audio"
- `display`: "standalone"
- `theme_color` / `background_color`: `#0a0a0b` (matches existing app background)
- `icons`: 192×192 and 512×512 PNGs, ChatGPT-generated (dark background, matching the app's gradient wordmark colors — prompt drafted separately)

### 2. `sw.js` — service worker

New root-level file, registered from `index.html`. Two distinct cache strategies:

**App shell** (`index.html`, `hype-audio.js`, `sync.js`, fonts/CSS, clip-art images from `images/clip-art-manifest.json`):
- **Network-first, falls back to cache when offline.**
- No manual cache-versioning needed — online users always get the latest deploy; offline users get whatever was last cached.

**Audio clips** (`storage_url` values from Supabase Storage, `hype-audio` bucket):
- **Cache-first, populated lazily** the first time each clip is actually played (cache-as-played, not eager).
- A clip never played on this device while offline is simply unavailable — the UI shows a small inline message ("not downloaded yet — needs a connection") on tap instead of a silent audio failure.

### 3. Media Session wiring (small addition to `hype-audio.js`)

In `playSingle`, set:
```js
navigator.mediaSession.metadata = new MediaMetadata({
  title: clip.title,
  artwork: [{ src: mentalityArt(clip.mentality), sizes: '512x512', type: 'image/png' }]
});
```

Action handlers, **mode-aware** (matches the existing three play modes — sequential `queue`, `randomFilter` loop, `repeatClip`):

| Mode | `nexttrack` | `previoustrack` |
|---|---|---|
| Sequential (`queue`) | advance to next clip in `queue.clips` | if >3s into current clip, restart it; else go back one (standard media-player convention) |
| Random loop (`randomFilter`) | pick a fresh random clip via `pickRandom(randomFilter)` | no-op — no meaningful "previous" in an infinite random stream |
| Repeat (`repeatClip`) | restart the current clip | restart the current clip |

`play`/`pause` handlers call the existing `togglePlay`/`stopPlayback` equivalents so lock-screen and in-app controls stay in sync via the existing `onPlaybackChange` subscription.

## Data flow

No new data model. `storage_url` (already on every clip) is both the `<audio>` source and the service-worker cache key. No backend changes, no new Supabase tables/columns.

## Error handling

- Clip not cached + offline: inline UI message, no silent failure, no console-only error.
- Service worker registration failure (e.g. `file://` context, unsupported browser): app functions exactly as it does today — Media Session and offline are progressive enhancements, never a hard dependency for basic playback.
- Media Session API unsupported (older browsers): no-op, no error — play/pause via the in-app buttons still works.

## Testing

No test framework in this static app (`hype-audio.selfcheck.js` / `sync.selfcheck.js` are plain assert-based self-checks, no Jest/etc.). Follow that existing pattern: add equivalent self-check functions covering:
- Mode-aware next/previous logic for all three play modes (pure function, testable without a real service worker or audio element).
- Service worker's URL-routing decision (app-shell vs. audio-clip cache strategy) as a pure function, testable without a real `fetch` event.

## Open items for the implementation plan

- ChatGPT icon prompt (drafted separately, Carl runs it in ChatGPT, resulting PNGs dropped into `images/`).

# Moment Modes

**Status:** Approved, ready for planning
**Date:** 2026-07-26

## Problem

Every clip already carries a `moment` field (`pre_workout` / `mid_set` / `post_workout`, set at upload time), and `pickRandom()` already accepts a `moment` filter — but nothing in the UI ever uses it. There's no way to say "just give me pre-workout hype, any pillar" without manually filtering by pillar/mentality first.

## Goal

Three buttons on the home screen — PRE / MID-SET / POST — each start an endless random loop across all pillars, filtered to that moment. Matches the existing `PLAY RANDOM` pattern exactly, so it needs no new mental model.

## Non-goals

- No new core playback logic in `hype-audio.js` beyond one small read-only helper (`isPlayingMoment`). `playRandomLoop({ moment: X })` already does everything needed — this is a UI feature, not a playback-engine feature.
- No pillar-scoped moment filtering (e.g., "PRE within Faith only") — the original ask was explicitly cross-pillar; a pillar's own moment filtering isn't in scope here.
- No simultaneous moment-mode + pillar-random-mode playback — mutually exclusive, for free, via the existing `queue`/`randomFilter`/`repeatClip` mutual-exclusion in `hype-audio.js`.

## Architecture

### 1. `hype-audio.js` — one new read-only helper

```js
function isPlayingMoment(moment) {
  return !!randomFilter && randomFilter.moment === moment && !randomFilter.pillar;
}
```

Distinguishes "random-looping this moment" from "a pillar's own PLAY RANDOM" — both use the same `randomFilter` state, but a moment-mode call never sets `pillar`, and a pillar's own random loop never sets `moment`. Exported on `window.HypeAudio` only (not needed in the Node-side `module.exports`, which is for migration-script consumers).

### 2. `index.html` — three buttons in `renderHome()`

New row below the 4 pillar tiles. For each of the three moments:

- Inactive: label (PRE / MID-SET / POST), tap starts `HypeAudio.playRandomLoop({ moment: 'pre_workout' })` (etc.) and calls `renderHome()` to re-render.
- No matching clips: `alert('No pre-workout clips yet.')` (etc.), matching the existing empty-state convention used by pillar/subcat `PLAY RANDOM` buttons — no new UI pattern.
- Active (`HypeAudio.isPlayingMoment('pre_workout')` true): shows `■ STOP`, tap calls `HypeAudio.stopPlayback()` and re-renders.
- Tapping a different moment button while one is active switches instantly — `playRandomLoop` already cancels whatever was playing, no extra code needed.

`HypeAudio.onPlaybackChange` already triggers a re-render of the current screen on state change (`hype-audio.js`'s existing subscription pattern) — `renderHome`'s callback needs to be added to that dispatch alongside the existing `renderSubcats`/`renderSection` calls, so the buttons stay in sync when a moment clip ends naturally (loops to the next one) or is stopped from elsewhere.

## Data flow

No new data model. `moment` already exists on every clip. No backend changes.

## Error handling

Same as existing `PLAY RANDOM` buttons: no matching clips shows an `alert()`, no silent failure, no new error-handling pattern to invent.

## Testing

No test framework in this static app. `isPlayingMoment` is a pure function reading module state — add a self-check case to `hype-audio.selfcheck.js` following the existing pattern (call `playRandomLoop({ moment: 'x' })`, assert `isPlayingMoment('x')` is true and `isPlayingMoment('y')` is false, assert a pillar-scoped `playRandomLoop({ pillar: 'faith' })` makes `isPlayingMoment` false for any moment).

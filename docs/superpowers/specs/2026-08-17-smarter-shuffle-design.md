# Smarter Shuffle

**Status:** Approved, ready for planning
**Date:** 2026-08-17

## Problem

`pickRandom()` and `pickFavoriteWeighted()` are pure random draws from a filtered pool — no memory of what just played, and no way to say "not this one for a bit" about a clip that's grating today. With 376+ clips this is rarely a problem in the abstract, but two concrete annoyances show up in real use: the same clip can come up twice in a row (or three times in one set), and there's no way to push a specific clip out of rotation temporarily without deleting it or hunting it down every time to skip past it.

## Goal

Two independent, additive behaviors layered onto the existing pickers:

1. **Explicit cooldown** — a "Not now" action on any clip excludes it from random/favorites picks for 1 day, then it's automatically back in rotation. No permanent decision, no hunting for an undo — just less friction than deleting or ignoring a clip you're not feeling right now.
2. **No-repeat window** — random/favorites loops avoid repicking any of the last 5 clips played in the current session, so a loop doesn't hand you the same clip twice in a row.

Both apply everywhere the shared pickers are used — hype-audio-app's own random/favorites loops, and Row's mini-player (`playMidSetHype`/`playPrRant`/moment-mode loops), since they all route through the same `pickRandom`/`pickFavoriteWeighted` functions in the file Row syncs from.

## Non-goals

- No inferred "skip" detection (early-abandon while playing, etc.) — explicit thumbs-down only, per Carl's call. Simpler, no playback-position tracking, no ambiguity about what counts.
- No permanent exclusion or play-count-based cooldown — days-based, auto-expiring, matches "not feeling this one right now" rather than a permanent judgment.
- No cross-device sync for the no-repeat window — it's ephemeral per-session state (mirrors `queue`/`randomFilter`), not data worth persisting or merging.
- No UI changes in Row — the cooldown/recency logic lives entirely in the shared `hype-audio.js` pickers, so Row's mini-player picks respect both automatically with zero Row-side changes.
- No change to manual playback (`playClip`, `playFromList`, `playRepeat`) — a clip on cooldown is still fully playable if the user picks it directly from a list; the cooldown only affects what the *random* pickers offer up.

## Architecture

### 1. `hype-audio.js` — new clip field + session state

```js
// New per-clip field, alongside favorite/play_count, synced through the
// existing cloud-sync path (no schema migration -- it's just another key
// in the clip object, same as every other field addClip/updateClip touch).
// clip.disliked_until: epoch ms | undefined
```

```js
// Session-only, never persisted -- mirrors the queue/randomFilter pattern.
// Reset naturally on page load; repeat-avoidance is a live-session nicety.
let recentlyPlayed = []; // up to 5 most recent clip ids, oldest first
const RECENT_WINDOW = 5;
const DISLIKE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day
```

### 2. `hype-audio.js` — shared eligibility filter

A single helper both pickers call, rather than duplicating the fallback chain twice (the file already has one instance of near-identical pool-filtering logic split across `pickRandom`/`pickFavoriteWeighted`; this adds a second filtering pass to both, so factoring it now avoids the exact double-duplication class code review flagged elsewhere in this file):

```js
// Narrows `pool` by cooldown + recency, each with a fallback to guarantee
// a non-empty result whenever `pool` itself is non-empty -- so a 2-clip
// mentality where both are cooling down still plays something, and a
// pool of exactly the 5 most-recent clips still plays something.
function filterEligiblePool(pool) {
  const now = Date.now();
  const notOnCooldown = pool.filter(function (c) { return !c.disliked_until || c.disliked_until <= now; });
  const base = notOnCooldown.length ? notOnCooldown : pool;
  const notRecent = base.filter(function (c) { return recentlyPlayed.indexOf(c.id) === -1; });
  return notRecent.length ? notRecent : base;
}
```

`pickRandom` and `pickFavoriteWeighted` each call `filterEligiblePool(pool)` immediately after building their existing filtered `pool` (mentality/moment/pillar match), before picking. No other change to either function's logic.

### 3. `hype-audio.js` — recording plays and dislikes

`playSingle`'s `onplay` handler (already the single place `play_count` increments via a fresh read) also pushes the clip's id onto `recentlyPlayed`, capped at `RECENT_WINDOW`:

```js
recentlyPlayed.push(clip.id);
if (recentlyPlayed.length > RECENT_WINDOW) recentlyPlayed.shift();
```

New exported function, following the existing `updateClip`-based pattern (e.g. `favBtn.onclick` toggling `favorite`):

```js
function toggleDislikeCooldown(clipId) {
  const clip = listClips().find(function (c) { return c.id === clipId; });
  if (!clip) return;
  const onCooldown = clip.disliked_until && clip.disliked_until > Date.now();
  updateClip(clipId, { disliked_until: onCooldown ? null : Date.now() + DISLIKE_COOLDOWN_MS });
}

function isOnCooldown(clip) {
  return !!(clip.disliked_until && clip.disliked_until > Date.now());
}
```

Both exported on `window.HypeAudio` and the Node `module.exports` (mirrors every other clip-mutation function).

### 4. `index.html` — "Not now" menu item

Each clip row's existing `⋮` dropdown (currently just `Delete`) gets a second item, inserted above Delete:

- Label reads `Not now (1 day)` when the clip isn't on cooldown; `Cancel cooldown` when `HypeAudio.isOnCooldown(clip)` is true.
- `onclick` calls `HypeAudio.toggleDislikeCooldown(clip.id)`, closes the dropdown, re-renders the section (same pattern the existing Delete item already follows: close → mutate → `renderSection(key, mentality)`).
- No confirmation prompt (unlike Delete) — fully reversible, low-stakes, same tap-weight as favoriting.

No change to the clip row's main button group (▶ / ☆ / 🔁) — cooldown status isn't visually indicated on the row itself beyond the menu label, to avoid a 5th always-visible icon on an already-tight mobile row. (Open question resolved: this is deliberately understated — a subtle row-level indicator can be added later if it turns out to matter in practice, but starting without one is the smaller diff.)

## Data flow

`disliked_until` is just another field in the `hype_audio` localStorage array, so it round-trips through the existing cloud-sync (`sync.js`'s `mergeArrays`, last-write-wins by `updated_at`, which `updateClip` already stamps) with no changes to the sync layer. `recentlyPlayed` never leaves `hype-audio.js`'s module scope.

## Error handling

`filterEligiblePool` never throws and never returns an empty array when `pool` is non-empty (the double-fallback guarantees this) — `pickRandom`/`pickFavoriteWeighted`'s existing `if (pool.length === 0) return null` check upstream is unaffected. `toggleDislikeCooldown` on an unknown clip id is a no-op (matches `updateClip`'s existing behavior for a missing id).

## Testing

Extend `hype-audio.selfcheck.js` following the existing pattern:

- `filterEligiblePool` (via `pickRandom`/`pickFavoriteWeighted`): a clip with `disliked_until` in the future is excluded from picks; one with `disliked_until` in the past (or absent) is eligible; a pool where *every* clip is on cooldown still returns a pick (fallback engages).
- No-repeat: after playing clip A, a pool of exactly `{A, B}` should heavily favor B (assert over N picks that A is never returned while B remains eligible and un-recent) — actually a small pool needs a deterministic assertion: with a 2-clip pool and A just played, the next pick from a fresh `pickRandom` call must be B every time (not probabilistic) since A is excluded and B is the only eligible clip.
- `recentlyPlayed` fallback: playing the same single clip repeatedly (pool of 1) still returns that clip once recency-filtering would otherwise empty the pool.
- `toggleDislikeCooldown`: toggling on sets `disliked_until` roughly `Date.now() + 1 day`; toggling again while active clears it back to falsy; `isOnCooldown` reflects both states correctly.

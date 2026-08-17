# State Modes

**Status:** Approved, ready for planning
**Date:** 2026-08-17

## Problem

Two related gaps, scoped down from a larger original idea after checking what Row's code actually supports:

1. **Row already classifies every logged set** (`row/gym-workout-events.js`'s `classifyWorkoutEvent`) as `'pr'` / `'grind'` (barely hit the rep floor) / `'miss'` (came in under it) / `null` (nothing notable) — but `gym.html`'s `startRestTimer` only acts on `'pr'` (its own rant). `'grind'` and `'miss'` both fall into the same generic `playMidSetHype()` call as a normal logged set, even though they're emotionally very different moments (grinding through a hard set vs. missing one entirely).
2. **hype-audio-app has no way to say "give me a specific mood"** — only pillar/mentality/moment filters, none of which map to a training *state* (heavy-effort day, low-motivation day, post-miss reset, focused day) that spans multiple pillars/mentalities at once.

Two other ideas from the original ranked batch — pre-PR-attempt escalation (before the set, not after) and a session-close wind-down — were checked against Row's actual code and dropped from this pass: neither has an existing hook (no live weight/rep comparison before logging, no "finish workout" button anywhere in `gym.html`). Building either means new UI Carl hasn't asked for; out of scope here.

## Goal

A `STATE_MODES` mapping in the shared `hype-audio.js` (four moods, each a set of exact pillar+mentality pairs, grounded in the real clip counts pulled live from Supabase):

- **Heavy Day** — `mindset/goggins` + `iron/training` + `carl/carl` + `faith/warfare` (~249 clips) — go-to-war energy.
- **Need Discipline** — `mindset/discipline` + `mindset/resilience` (35 clips) — show-up-anyway energy.
- **Post-Failure Reset** — `faith/grace` + `faith/trials` + `carl/faith` + `carl/mortality` (35 clips) — grace, not more grit.
- **Locked In** — `mindset/purpose` + `carl/mastery` + `faith/scripture` (38 clips) — quieter, why-you're-doing-this focus.

Two consumers, both cheap once the mapping exists:

- **Row** (primary value): `'grind'` → Need Discipline, `'miss'` → Post-Failure Reset, single clip per logged set, same call shape as the existing `playPrRant()`.
- **hype-audio-app home screen** (bonus, low cost): 4 buttons below the existing PRE/MID-SET/POST row, tap starts an endless random loop for that mood — identical interaction to the existing moment buttons.

## Non-goals

- No pre-PR-attempt escalation, no session-close wind-down (see Problem — no existing hook for either).
- No new playback-state machinery. `randomFilter` already flows generically through `pickRandom`/`advance`/`isPlayingRandomFilter`/`stopPlayback` — state modes ride the exact same mechanism as a new filter shape (`{ stateMode: 'heavy_day' }`), not a parallel system.
- `'pr'` is untouched — it already gets its own dedicated rant via `playPrRant()`, which is working.
- No change to Row's rest-timer UI/duration/display logic — only which clip function gets called for `'grind'`/`'miss'`.
- `unused` mentalities (`carl/drive`, `carl/forge`, `faith/worship` — all under 10 clips) don't feed any mode; still fully browsable, just not part of an automatic pool. Forcing them in would dilute modes that already work.

## Architecture

### 1. `hype-audio.js` — `STATE_MODES` + `pickRandom` extension

```js
// Pillar+mentality pairs, not bare mentality strings -- mentality names
// aren't guaranteed unique across pillars (e.g. carl/faith vs a
// hypothetical future faith-pillar mentality), so pairs avoid any
// cross-pillar collision. Counts as of 2026-08-17's live Supabase pull;
// not enforced/validated against actual data, just the composition basis.
const STATE_MODES = {
  heavy_day: {
    pairs: [
      { pillar: 'mindset', mentality: 'goggins' },
      { pillar: 'iron', mentality: 'training' },
      { pillar: 'carl', mentality: 'carl' },
      { pillar: 'faith', mentality: 'warfare' },
    ],
  },
  need_discipline: {
    pairs: [
      { pillar: 'mindset', mentality: 'discipline' },
      { pillar: 'mindset', mentality: 'resilience' },
    ],
  },
  post_failure_reset: {
    pairs: [
      { pillar: 'faith', mentality: 'grace' },
      { pillar: 'faith', mentality: 'trials' },
      { pillar: 'carl', mentality: 'faith' },
      { pillar: 'carl', mentality: 'mortality' },
    ],
  },
  locked_in: {
    pairs: [
      { pillar: 'mindset', mentality: 'purpose' },
      { pillar: 'carl', mentality: 'mastery' },
      { pillar: 'faith', mentality: 'scripture' },
    ],
  },
};
```

`pickRandom` gains one branch: when `filter.stateMode` is set, the pool is built from `STATE_MODES[filter.stateMode].pairs` (OR across pairs) instead of the existing pillar/mentality/moment AND-filter. Everything after pool-building (the `pool.length === 0` guard, `filterEligiblePool`, the random pick) is unchanged and shared:

```js
function pickRandom(filter) {
  filter = filter || {};
  let pool;
  if (filter.stateMode) {
    const mode = STATE_MODES[filter.stateMode];
    pool = mode
      ? listActiveClips().filter(function (c) {
          return mode.pairs.some(function (p) { return c.pillar === p.pillar && c.mentality === p.mentality; });
        })
      : [];
  } else {
    const pillars = Array.isArray(filter.pillar) ? filter.pillar : (filter.pillar ? [filter.pillar] : null);
    pool = listActiveClips().filter((c) =>
      (!filter.mentality || c.mentality === filter.mentality) &&
      (!filter.moment || c.moment === filter.moment) &&
      (!pillars || pillars.indexOf(c.pillar) !== -1)
    );
  }
  if (pool.length === 0) return null;
  const eligible = filterEligiblePool(pool);
  return eligible[Math.floor(Math.random() * eligible.length)];
}
```

Because `randomFilter` is just whatever object was passed to `playRandomLoop`, and `advance()` already calls `pickRandom(randomFilter)` generically on every loop continuation, **a state-mode loop needs zero changes to `playRandomLoop`, `advance`, or `stopPlayback`** — passing `{ stateMode: 'heavy_day' }` as the filter is enough. `isPlayingRandomFilter` gets one more field in its equality check:

```js
function isPlayingRandomFilter(filter) {
  if (!randomFilter) return false;
  filter = filter || {};
  return randomFilter.pillar === filter.pillar && randomFilter.mentality === filter.mentality &&
    randomFilter.moment === filter.moment && randomFilter.stateMode === filter.stateMode;
}
```

### 2. `hype-audio.js` — single-shot wrapper for Row

Mirrors `playPrRant()`'s exact shape (pick once, play once, return the clip or null):

```js
function playStateMode(modeKey) {
  const clip = pickRandom({ stateMode: modeKey });
  if (clip) playClip(clip);
  return clip;
}
```

### 3. `row/gym.html` — wire `'grind'`/`'miss'` to the right mood

`startRestTimer` (around line 5348-5354) currently has:

```js
if (restTimerEventType === 'pr') window.HypeAudio.playPrRant();
else window.HypeAudio.playMidSetHype();
```

Becomes:

```js
if (restTimerEventType === 'pr') window.HypeAudio.playPrRant();
else if (restTimerEventType === 'grind') window.HypeAudio.playStateMode('need_discipline');
else if (restTimerEventType === 'miss') window.HypeAudio.playStateMode('post_failure_reset');
else window.HypeAudio.playMidSetHype();
```

A normal logged set (`eventType === null`) keeps its current generic mid-set hype behavior — only the two previously-undifferentiated cases change.

### 4. `index.html` — 4 home-screen buttons

New row below the existing `moment-row`, following that row's exact rendering pattern (`renderHome()`'s `MOMENTS.forEach` block) with a local label map:

```js
const STATE_MODE_LABELS = {
  heavy_day: 'Heavy Day',
  need_discipline: 'Need Discipline',
  post_failure_reset: 'Post-Failure Reset',
  locked_in: 'Locked In',
};
```

Each button: inactive shows its label, tap calls `HypeAudio.playRandomLoop({ stateMode: key })`; active (`HypeAudio.isPlayingRandomFilter({ stateMode: key })`) shows `■ STOP`, tap calls `HypeAudio.stopPlayback()`. No matching clips shows the same `alert()` convention every other random-play button already uses. Wired into the existing `HypeAudio.onPlaybackChange` re-render dispatch alongside `renderHome`'s other callers (already happens automatically since `renderHome` is already in that dispatch for the moment row).

## Data flow

`STATE_MODES` is a static code constant, not user data — no Supabase involvement, no sync concern beyond the standard "re-copy `hype-audio.js` to Row" step this repo's whole core-logic file already requires for every change.

## Error handling

`pickRandom({ stateMode: 'unknown_key' })` returns `null` (the `mode ? ... : []` fallback produces an empty pool, hits the existing `pool.length === 0` guard) — same "no clips" path every other empty-pool case already takes, no new error type. `playStateMode` on a `null` pick is a no-op, matching `playPrRant`/`playMidSetHype`'s existing behavior.

## Testing

Extend `hype-audio.selfcheck.js`:

- `pickRandom({ stateMode: 'heavy_day' })` only returns clips matching one of that mode's exact pillar+mentality pairs; a clip matching the mentality but wrong pillar (or vice versa) is excluded.
- `pickRandom({ stateMode: 'unknown_key' })` returns `null` without throwing.
- `filterEligiblePool`'s cooldown/recency behavior (already tested for the plain pillar/mentality path) applies identically to the `stateMode` path — a cooled-down clip in a mode's pool is excluded the same way.
- `playStateMode` plays the picked clip (via `playClip`) and returns it; returns `null` and plays nothing when the mode's pool is empty.
- `isPlayingRandomFilter({ stateMode: 'heavy_day' })` is true only while that exact mode's loop is active, false during a different mode's loop, a plain pillar/mentality loop, or a moment loop (mirrors the existing pillar-vs-moment exact-match test already in the file).

No test framework covers `row/gym.html`'s `startRestTimer` change or `index.html`'s new button row (same precedent as the 2026-07-26 moment-modes spec) — both get live browser verification instead.

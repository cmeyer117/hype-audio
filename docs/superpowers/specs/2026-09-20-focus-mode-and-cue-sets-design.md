# Focus Mode + Personal Cue Sets — Design

## Context

From `Codex Outputs/2026-09-19-audio-effects-hype-audio-research.md`: don't add a 5th "Focus" pillar, don't chase brainwave-frequency/exact-BPM claims. Keep the 4 existing pillars (Mindset, Iron, Faith, Carl) and 3 moments (Pre-Workout, Mid-Set, Post-Workout) — those answer "what kind of content" and "when." The real gap is neither answers "what task is the listener trying to perform." The `use_case`/`delivery_role` schema tags already shipped (`hype-audio@2661efc`); this build is the two MVP experiences the research doc names on top of them: a Focus session, and personal instructional cue sets.

## Goal

Let Carl start a genuine low-distraction Focus session (instrumental/noise/silence, timed, no random speech) and quick-play a small named set of personal instructional cues (Brace, Controlled Eccentric, Final Rep, Post-Miss Reset) — while capturing just enough data to eventually tell whether either actually helps, without building a dashboard yet.

## Architecture

Both features live in `index.html`'s existing `view-home` alongside `moment-row`/`state-mode-row` — no new page, no new view (this app has exactly one main view plus a few full-screen sub-views for review/content-ideas/recap; a Focus session is not that kind of feature). New logic lives in `hype-audio.js` (the shared core Row also vendors a copy of, per its header comment) alongside the existing `pickRandom`/`playRandomLoop`/`logHypeEvent` functions.

### Focus mode

A new "Focus" button opens an inline `<details>` panel (matching the existing "Upload a clip"/"Record a clip" `<details>` convention) with two choices:
- **Duration:** 25 min / 50 min (radio-style buttons, matching `moment-btn` styling)
- **Sound:** Audio / Silence

Starting a session:
- **Audio:** `HypeAudio.playRandomLoop({ useCase: 'study_focus', deliveryRole: ['instrumental', 'noise', 'silence_baseline'] })` — no `motivational_speech`/`instructional_cue`/`scripture_prayer` in the pool, matching the research doc's "no random speech" instruction.
- **Silence:** no audio call at all, just the timer.

Both start a visible countdown (reusing the existing rest-timer-style elapsed/countdown display pattern already in the record-clip UI) with fade-out in the final ~10 seconds for Audio mode (`audio.volume` ramp, not a new audio-processing chain). Manually stopping early or the timer completing both end the session the same way.

**On session end:** a single inline prompt, "Did that help you focus?" with three buttons — Yes / No / Skip. Whichever is tapped (or if the panel is dismissed without answering, treated as Skip) logs a `focus_session_outcome` event and closes the panel.

### `pickRandom`/`playRandomLoop` filter extension

Today's filter object supports `pillar` (single or array), `mentality`, `moment`, `stateMode`. Add two new optional fields:
- `useCase: string` — exact match against `clip.use_case`.
- `deliveryRole: string[]` — clip's `delivery_role` must be in this array.

Both are additive to the existing filter predicate (AND'd with whatever else is present) — no existing caller passes these fields today, so no existing behavior changes.

### Personal cue sets

A new "Cues" row (same `.moment-row` styling as `moment-row`/`state-mode-row`) with four buttons: **Brace**, **Controlled Eccentric**, **Final Rep**, **Post-Miss Reset**. These map to four fixed `mentality` values: `brace`, `controlled_eccentric`, `final_rep`, `post_miss_reset`.

Tapping a cue button: `HypeAudio.pickRandom({ mentality: '<key>', deliveryRole: ['instructional_cue'] })` then `playClip()` if found (single-shot, not a loop — these are 15-45s cues, not a session). If no clip matches, an alert names the exact mentality value to use: `"No Brace cue recorded yet -- use Record a clip below, mentality: brace, delivery role: Instructional cue."` — matching the existing `alert('No ' + m.label.toLowerCase() + ' clips yet.')` pattern already used for empty moment/state-mode pools.

**No new recording UI.** The existing "Record a clip" `<details>` panel already asks for mentality + delivery role (`instructional_cue` is already an option in `record-delivery-role-input`) — recording a cue is just filling that form with the matching mentality string.

### Measurement

`logHypeEvent(type, clip)` gains an optional third parameter, `extra` (object), merged into the logged event: `{ useCase, deliveryRole, sessionId }` where applicable. Focus session playback calls `logHypeEvent('play', clip, { useCase: 'study_focus', deliveryRole: clip.delivery_role, sessionId })`; cue taps log the same shape without a `sessionId`.

A new event type, `focus_session_outcome`, is logged directly (not through a clip-based call — no clip is associated with a Skip/Silence-mode outcome) with `{ sessionId, durationMinutes, sound: 'audio'|'silence', outcome: 'yes'|'no'|'skip' }`.

No dashboard, no aggregation, no weekly-recap integration for v1 — this only makes the data exist for a future pass, per the research doc's own "measurement before optimization" framing (30-day test window, at least 12 logged sessions, before drawing any conclusion).

## Error handling

Matches the app's existing fail-soft posture throughout: `pickRandom` returning `null` (no matching pool) already degrades to an alert everywhere else in this codebase — Focus mode and cue buttons do the same, never a thrown error. `logHypeEvent` already wraps its body in try/catch and silently drops on failure; the new `focus_session_outcome` logging call does the same.

## Testing

`hype-audio.selfcheck.js` already exists as this repo's assert-based self-check convention (no formal test framework — see the ponytail rule "Non-trivial logic... leaves ONE runnable check behind"). Add self-check coverage for:
- `pickRandom` filtering by `useCase` alone, `deliveryRole` alone, and both combined.
- `pickRandom({ useCase, deliveryRole })` returning `null` when no clip matches (not throwing, not returning an unrelated clip).
- `logHypeEvent`'s `extra` parameter merging correctly into the logged event shape, and defaulting cleanly when omitted (existing callers keep working unchanged).

## Out of scope

- Any dashboard or aggregate view of focus/cue outcomes.
- Adaptive/AI-suggested cue wording — cues are Carl's own recorded voice, same "never generate/suggest wording" stance the rest of this app's recording features already have.
- A "Lift session" pool reorganization (the research doc's MVP item 2) — that's a broader reshuffle of the existing state-mode UI, not a new capability, and is explicitly out of scope for this build.
- New recording UI specific to cues — the existing generic record form covers it.

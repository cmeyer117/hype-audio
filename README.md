# hype-audio-app

Standalone motivation-audio app — upload short hype clips (Goggins/Dorian-style),
play them back by mentality/moment, filtered by pillar (`iron`/`faith`). This repo
is the canonical copy of `hype-audio.js`, manually re-copied to the `row` repo
whenever it changes (Row's `gym.html` mini-player calls into it). `sync.js` is
deliberately NOT kept in sync with Row's copy -- Row has its own real divergence
(an owner-auth token flow this single-passphrase app doesn't have). Before
overwriting anything in Row from here, check `git log -- <file>` in Row first --
see `hype-audio.js`'s own header comment and Row's `hype-audio.selfcheck.cjs`.

Live: https://hype-audio-app.vercel.app

## Play log and workout-cue pin

Plays, feedback, focus outcomes and the workout-cue pin all live in one append-only
event log in `hype-audio.js`, stored in localStorage under `hype_audio_events` (the
`EVENTS_LS_KEY` constant) and synced alongside `hype_audio`.

### Events

Every write goes through `appendHypeEvent(build)`, which stamps `at` and `updated_at`
with the same `Date.now()` value. Event types:

| type | written by | id format |
| --- | --- | --- |
| `play` | `logHypeEvent('play', clip, extra)` | `<clipId>\|play\|<now>` |
| `feedback_up` | `logHypeEvent('feedback_up', clip)` | `<clipId>\|feedback_up\|<now>` |
| `feedback_down` | `logHypeEvent('feedback_down', clip)` | `<clipId>\|feedback_down\|<now>` |
| `pin` | `pinCue(id)` | `pin\|<clipId or none>\|<now>` |
| `focus_session_outcome` | `logFocusSessionOutcome(data)` | `focus_session_outcome\|<sessionId>\|<now>` |

Ids are built from the content plus the timestamp (not a random uuid), so the same
event reaching a device twice, once locally and once back from the cloud, has one
stable dedup key and is not counted twice. Two devices logging independently at
different instants get different ids and both events are kept.

### Retention

On each append, `appendHypeEvent` drops entries that are older than 90 days
(`EVENT_RETENTION_MS`), future-dated, or lack a numeric `at`. After the new event is
pushed, only the newest 2000 are kept (`EVENT_MAX_COUNT`).

### Pin events

- `pinnedCue()` resolves the pin with `newestPin(events)`: the `pin` event with the
  newest `at`, ties broken by the larger `id` (string compare), so every replica picks
  the same pin whatever order its log is in.
- A pin with `clipId: null` means unpinned. `pinCue(id)` on the clip that is already
  pinned appends such an unpin event.
- `pinnedCue()` returns `null` when there is no pin, the newest pin is an unpin, or
  the pinned clip no longer exists among the active clips.
- `keepPin(pruned, all)` runs at the end of every prune and re-adds the current
  newest pin if the age, future-date or 2000-cap prune would have dropped it. The
  current pin is never pruned. (An older, superseded pin can be.)
- Pins are events, not a flag on the clip, so pinning never changes a clip's
  `updated_at`.

### Home primary button

`lastCue()` is the most recently played (`play` event, newest `at`) clip that still
exists. The Home primary button (`#play-first-btn` in `index.html`) picks its label
and action in this order:

1. A cue is playing: `■ Stop`.
2. The library is empty: `No cues here yet. Add one` (opens the add form).
3. `pinnedCue()` exists: `▶ Pinned cue: <title>`.
4. Otherwise `lastCue()` exists: `▶ Continue: <title>`.
5. Otherwise `▶ Play a cue` (plays a random loop).

So the order is Pinned cue, then Continue last cue, then Play a cue, then Add one when
the library is empty. The empty-library check actually comes first, but with no clips
there can be no pinned or last cue, so it never conflicts.

### Who reads the log

Row's gym player is its own fork, `row-hype.js` in the Row repo. Its Play cue button
plays the pinned cue (`playWorkoutCue`), and the newest-pin rule (`newestPin`) is
duplicated there, so a change to it here needs the same change in Row. Vision's hype play-log code also reads the log, but neither
Row's fork nor Vision's code is in this repo, so their internals are not documented here.

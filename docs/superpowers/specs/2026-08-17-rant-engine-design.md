# Rant Engine

**Status:** Approved, ready for planning
**Date:** 2026-08-17

## Problem

Two independent gaps, both confirmed against live data rather than assumed:

1. **All 66 `carl`-pillar clips have zero `transcript_text`** (confirmed via a live Supabase query). The precedent transcription script, `instagram-cleanup/fetch-missing-transcripts.py`, explicitly excludes them: `protected_mentalities = {"carl", "goggins"}`. Without a transcript, these clips are invisible to `searchClips`/`quotePreview` — the most personally valuable clips in the library (Carl's own recorded voice, not pulled content) are the least discoverable.
2. **No path from a hype-audio clip into the content pipeline.** `content_ideas` (211 existing rows, all from the creator-intelligence pipeline) has no notion of "this idea came from a specific rant I already recorded" — turning a workout-floor rant into a caption/reel means re-remembering it exists and re-typing everything from scratch.

## Goal

Two pieces, independently useful, sharing one join key (the clip's `id`):

1. **Transcription script** — a new local script, adapted from the existing precedent, that fills in `transcript_text` for any `carl`-pillar clip missing one. Run manually whenever there's a backlog (matches the existing pattern; the 66-clip backlog is the first run).
2. **Content-idea bridge** — a new "Content Ideas" review screen in hype-audio-app listing transcribed-but-not-yet-sent `carl` clips, with editable Title/Hook/Pillar/Body (defaulting to the transcript), that writes a `content_ideas` row through a new passphrase-gated server endpoint.

## Non-goals

- No AI-generated hooks or pillar classification — Carl (or whoever curates) writes/edits these by hand per clip, same as every existing `content_ideas` row is hand-curated (even the creator-intelligence ones carry human-reviewed `notes`, not raw auto-dumps).
- No automatic transcription on new recordings — Whisper can't run in-browser; wiring it into the save flow would need new server infra. One-off script, matching the existing precedent, per Carl's call.
- No changes to the transcription precedent script itself (`fetch-missing-transcripts.py` stays as-is for its existing Instagram-pull use case) — this is a new, separate script for the `carl` pillar specifically.
- No retroactive backfill of `content_ideas` rows for clips that were already manually turned into content before this existed — only forward-looking from whenever this ships.
- No UI change to the existing title-review screen — a new, separate screen, following its pattern but not touching its code.

## Architecture

### 1. Transcription script (new, local, offline)

New script at `hype-audio-app/scripts/transcribe-carl-rants.py` — this repo's own `scripts/` folder already holds two other transcription scripts (`transcribe-rants.py`, `transcribe-remaining-goggins.py`), but both are for an earlier pipeline stage (raw pre-upload video files in local folders, transcribed before ever reaching Supabase) and don't apply here. `fetch-missing-transcripts.py` in `instagram-cleanup` is the real precedent — same shape as this problem (clip already in Supabase, missing `transcript_text`, has a `storage_url` to download from) — but it lives there because it's Instagram-pull-specific; this is `carl`-pillar-specific, so it belongs in hype-audio-app's own `scripts/` instead. Adapted from it with two real differences:

- **Joins on clip `id`**, not the old title-slug hack (`title.rsplit(" - ", 1)[-1]`) — hype-audio clips already carry a stable `id`; the slug hack existed only because the precedent's Instagram-pulled clips didn't have one at the time.
- **No `protected_mentalities` exclusion** — the entire point is covering the clips that exclusion skipped.

Flow per clip: download `storage_url` to a local temp file → run local `whisper <file> --model base --output_format json` (same model/flags as the precedent, zero API cost) → read the output JSON's `text` field → write it back to Supabase.

**Correction from the first draft of this spec:** this does NOT need the service-role key. `hype-audio-app/scripts/update-existing-clips.js` is the real precedent for pushing back into `app_state` from a script — it reads the `hype-audio` row's `data.hype_audio` array with the plain anon/publishable key, mutates the target clip in memory, and `upsert`s the whole row back, exactly matching this app's own live RLS policy (`"hype-audio anon access to app_state" roles:{anon} qual:(key = 'hype-audio')`). The service-role key is reserved for the two things anon genuinely can't do (Storage writes, `content_ideas` writes below) — using it here would be an unnecessary downgrade, not a requirement. This script follows the same read-mutate-upsert shape via `urllib.request` (already the import style `fetch-missing-transcripts.py` uses for the audio download) — one script, one language, the same REST-level operation `sync.js`'s own `flushOnUnload` already performs from the browser side.

### 2. New clip field: `content_idea_sent`

```js
// clip.content_idea_sent: true | undefined
```

Set via the existing `updateClip` (synced through cloud sync like every other clip field, no schema change). Drives the review queue's filter: eligible = has `transcript_text`, pillar is `carl`, and `content_idea_sent` is not `true`.

### 3. `/api/create-content-idea.mjs` (new Vercel function)

Mirrors `/api/upload-clip.mjs` exactly: validates the same shared passphrase header (`x-upload-secret` against `HYPE_AUDIO_UPLOAD_SECRET` — reusing the existing secret rather than minting a new one, since it's the same trust boundary: one user, one passphrase, gating writes the anon key can't make), uses the service-role key server-side, inserts into `content_ideas`. Request body: `{ title, hook, pillar, body }`. Response: `{ id }` on success.

Field mapping on insert:
- `title` ← from the form (default: clip's own `title`)
- `hook` ← from the form (no default — a rant's title isn't automatically a good hook, this is exactly the manual-curation step)
- `pillar` ← a select constrained to the content_ideas pillar vocabulary confirmed live in Supabase: `mindset` (113 existing rows), `training` (62), `life` (16), `faith` (12), `diet` (8) — defaults to `mindset`, changeable per clip. A free-text field risks introducing a stray pillar value that silently breaks downstream content-pipeline filtering that assumes this fixed set.
- `body` ← from the form, defaults to the clip's full `transcript_text`
- `notes` ← auto-filled, not editable: `Source: hype-audio clip <id> (<storage_url>)` — so whoever drafts the actual video can find the original audio again
- `platform`/`status` — left at their table defaults (`tiktok`/`IDEA`), not exposed in the form; every other pillar in this table already starts there

### 4. `index.html` — new "Content Ideas" review screen

New `view-content-ideas` div + `showContentIdeas()`/`renderContentIdeas()` functions, following the existing `view-title-review`/`renderTitleReview()` pattern (hidden/shown alongside the other views, wired into the same nav reset logic those functions already follow). Unlike title-review's plain Apply/Dismiss, each row needs editable inputs:

- Transcript preview (read-only, via the existing `quotePreview` helper)
- Title input (defaults to `clip.title`)
- Hook input (empty by default)
- Pillar select (the 5 values above, default `mindset`)
- "Send to Content Ideas" button — POSTs to `/api/create-content-idea.mjs` (passphrase from the same `localStorage` key `uploadClipFile` already uses, so no second passphrase prompt if the user already unlocked uploads this session), and on success calls `HypeAudio.updateClip(clip.id, { content_idea_sent: true })` and re-renders.
- Failure shows an `alert()` with the real error message, matching every other network-call convention in this file (`uploadClipFile`'s error surfacing).

Reachable from a new home-screen link, same placement/visibility pattern as the existing `title-review-link` (only shown when the queue is non-empty, with a count).

## Data flow

`transcript_text` and `content_idea_sent` are both plain fields on the clip object, round-tripping through the existing cloud-sync (`sync.js`'s `mergeArrays`, `updateClip` already stamps `updated_at`) with no sync-layer changes. The transcription script writes directly to Supabase (bypassing the app's localStorage-then-sync path entirely, since it's not running in a browser) — the next time the app syncs, `applyRemote` picks up the new `transcript_text` values like any other remote change.

## Error handling

The transcription script: a failed download or a Whisper timeout for one clip doesn't stop the batch (matches the precedent's per-clip try/except, tracks `ok`/`err` counts, prints a summary). The content-idea bridge: `/api/create-content-idea.mjs` returns 401 on a bad passphrase (clears the stored one, matching `uploadClipFile`'s existing 401 handling) and 400 on missing required fields (`title`, `pillar`); the client shows the real error via `alert()`, never a silent failure.

## Testing

**Transcription script:** no automated test — it's a local batch tool over real network/subprocess calls, same as the precedent it's adapted from (which also has none). Verified by running it against a small real subset and confirming `transcript_text` lands in Supabase correctly.

**hype-audio.js additions:** extend `hype-audio.selfcheck.js` — the review queue's eligibility filter (has transcript + pillar carl + not yet sent) as a pure predicate function, tested the same way `filterEligiblePool` and `STATE_MODES` were.

**`/api/create-content-idea.mjs` and the review screen:** no test framework covers either (same precedent as every other API endpoint and UI screen in this app) — live browser verification, including one real end-to-end row landing in `content_ideas` and getting cleaned up afterward (not left as test data in a live content pipeline table with 211 real rows).

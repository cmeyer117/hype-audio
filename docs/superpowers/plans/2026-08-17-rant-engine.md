# Rant Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transcribe the 66 untranscribed `carl`-pillar clips via a local Whisper script, and add an in-app "Content Ideas" review screen that sends a clip's transcript into the `content_ideas` table through a new passphrase-gated server endpoint.

**Architecture:** A pure eligibility predicate (`hasPendingContentIdea`) drives a new review-queue screen, following the existing title-review screen's pattern exactly. Sending a clip calls a new `/api/create-content-idea.mjs` (mirrors `/api/upload-clip.mjs`'s passphrase-gate + service-role-key shape). The transcription script is independent — a local Python tool that writes `transcript_text` back into Supabase using the anon key directly (matching `update-existing-clips.js`'s proven read-mutate-upsert pattern), no server endpoint involved.

**Tech Stack:** Plain JS (hype-audio.js, index.html), Vercel serverless function (`.mjs`), Python (transcription script, matching the existing `scripts/` precedent), Node-based selfcheck harness for the testable pieces.

**Spec:** `docs/superpowers/specs/2026-08-17-rant-engine-design.md`

---

### Task 1: `hasPendingContentIdea` eligibility predicate

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`
- Test: `C:\Users\gregm\hype-audio-app\hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Insert before the final `console.log` line in `hype-audio.selfcheck.js`:

```js
// hasPendingContentIdea -- eligible for the Content Ideas review queue:
// pillar carl, has a transcript, not already sent.
HypeAudio.addClip({ id: 'rant1', title: 'Rant Test A', pillar: 'carl', mentality: 'carl', transcript_text: 'A real transcript.', play_count: 0 });
assertEqual(HypeAudio.hasPendingContentIdea(HypeAudio.listClips().find(c => c.id === 'rant1')), true, 'a carl clip with a transcript and not yet sent is eligible');
HypeAudio.addClip({ id: 'rant2', title: 'Rant Test B', pillar: 'carl', mentality: 'carl', play_count: 0 });
assertEqual(HypeAudio.hasPendingContentIdea(HypeAudio.listClips().find(c => c.id === 'rant2')), false, 'a carl clip with no transcript is not eligible');
HypeAudio.addClip({ id: 'rant3', title: 'Rant Test C', pillar: 'carl', mentality: 'carl', transcript_text: 'Already sent.', content_idea_sent: true, play_count: 0 });
assertEqual(HypeAudio.hasPendingContentIdea(HypeAudio.listClips().find(c => c.id === 'rant3')), false, 'a carl clip already sent is not eligible even with a transcript');
HypeAudio.addClip({ id: 'rant4', title: 'Rant Test D', pillar: 'faith', mentality: 'grace', transcript_text: 'Not a carl clip.', play_count: 0 });
assertEqual(HypeAudio.hasPendingContentIdea(HypeAudio.listClips().find(c => c.id === 'rant4')), false, 'a non-carl clip is never eligible, even with a transcript');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node hype-audio.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: `TypeError: HypeAudio.hasPendingContentIdea is not a function`

- [ ] **Step 3: Implement**

In `hype-audio.js`, find:

```js
  var UPLOAD_SECRET_KEY = 'hype_audio_upload_secret';
```

Insert immediately **before** it:

```js
  // Eligible for the Content Ideas review queue -- see
  // docs/superpowers/specs/2026-08-17-rant-engine-design.md.
  function hasPendingContentIdea(clip) {
    return !!clip && clip.pillar === 'carl' &&
      typeof clip.transcript_text === 'string' && clip.transcript_text.trim().length > 0 &&
      clip.content_idea_sent !== true;
  }

```

Then find the `window.HypeAudio = {` export block and, after its `toggleDislikeCooldown: toggleDislikeCooldown,` line, add `hasPendingContentIdea: hasPendingContentIdea,`. Do the same in the `module.exports = {` block after its own `toggleDislikeCooldown: toggleDislikeCooldown,` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(rant-engine): add hasPendingContentIdea eligibility predicate"
```

---

### Task 2: `/api/create-content-idea.mjs`

**Files:**
- Create: `C:\Users\gregm\hype-audio-app\api\create-content-idea.mjs`

No automated test — mirrors `/api/upload-clip.mjs`, which also has none (same live-verification precedent).

- [ ] **Step 1: Create the file**

```js
// Vercel serverless function -- the only path allowed to write into
// content_ideas from hype-audio-app. RLS on content_ideas only grants ALL
// to `authenticated` under coaching_is_owner() (confirmed live via
// pg_policies) -- hype-audio-app has no login system, so anon can't write
// here at all. Same trust model as /api/upload-clip.mjs: service-role key
// server-side, gated by the same shared passphrase (one user, one secret,
// reused rather than minting a second one for the same trust boundary).
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co'
const ALLOWED_PILLARS = ['mindset', 'training', 'life', 'faith', 'diet']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.HYPE_AUDIO_UPLOAD_SECRET
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured: HYPE_AUDIO_UPLOAD_SECRET not set' })
    return
  }
  if (req.headers['x-upload-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { title, hook, pillar, body, sourceClipId, sourceStorageUrl } = req.body || {}
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Missing or invalid title' })
    return
  }
  if (typeof pillar !== 'string' || !ALLOWED_PILLARS.includes(pillar)) {
    res.status(400).json({ error: 'Missing or invalid pillar' })
    return
  }

  const notes = (typeof sourceClipId === 'string' && sourceClipId)
    ? `Source: hype-audio clip ${sourceClipId} (${typeof sourceStorageUrl === 'string' ? sourceStorageUrl : 'no storage_url'})`
    : null

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase
    .from('content_ideas')
    .insert({
      title: title.trim(),
      hook: typeof hook === 'string' && hook.trim() ? hook.trim() : null,
      pillar,
      body: typeof body === 'string' && body.trim() ? body.trim() : null,
      notes,
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    console.error('[create-content-idea] insert failed:', error?.message)
    res.status(502).json({ error: 'Could not create content idea' })
    return
  }

  res.status(200).json({ id: data.id })
}
```

- [ ] **Step 2: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add api/create-content-idea.mjs
git commit -m "feat(rant-engine): add create-content-idea API endpoint"
```

---

### Task 3: `sendToContentIdea` in `hype-audio.js`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`

No automated test — mirrors `uploadClipFile`, an async `fetch`-based function that also has no Node-side test (live-verification precedent).

- [ ] **Step 1: Implement**

In `hype-audio.js`, find `uploadClipFile`'s closing brace:

```js
    if (!putRes.ok) return { url: null, error: 'Storage upload failed (' + putRes.status + ').' };
    return { url: body.publicUrl, error: null };
  }
```

Insert immediately after it:

```js

  // Returns { id, error }. Reuses the same stored passphrase uploadClipFile
  // already prompts for -- one secret, one trust boundary, no reason to
  // prompt twice in the same session.
  async function sendToContentIdea(clip, fields) {
    var secret = getUploadSecret();
    if (!secret) return { id: null, error: 'Cancelled — no passphrase entered.' };

    var res;
    try {
      res = await fetch('/api/create-content-idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-upload-secret': secret },
        body: JSON.stringify({
          title: fields.title,
          hook: fields.hook,
          pillar: fields.pillar,
          body: fields.body,
          sourceClipId: clip.id,
          sourceStorageUrl: clip.storage_url,
        }),
      });
    } catch (e) {
      return { id: null, error: 'Network error.' };
    }

    var responseBody = {};
    try { responseBody = await res.json(); } catch (e) {}

    if (!res.ok) {
      if (res.status === 401) clearUploadSecret();
      return { id: null, error: responseBody.error || ('Failed (' + res.status + ').') };
    }
    return { id: responseBody.id, error: null };
  }
```

Then find the `window.HypeAudio = {` export block and, after its `uploadClipFile: uploadClipFile,` line, add `sendToContentIdea: sendToContentIdea,`.

- [ ] **Step 2: Run the full selfcheck suite as a regression check**

Run: `node hype-audio.selfcheck.js && node sync.selfcheck.js && node sw.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: all three print `all assertions passed`

- [ ] **Step 3: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js
git commit -m "feat(rant-engine): add sendToContentIdea"
```

---

### Task 4: "Content Ideas" review screen in `index.html`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\index.html`

No test framework covers UI here (same precedent as every other screen in this app) — live browser verification, including one real row landing in `content_ideas` and getting cleaned up afterward.

- [ ] **Step 1: Add the view markup**

Find:

```html
  <div id="view-title-review" style="display:none; padding: 0 10px">
    <div class="back-row">
      <button class="back-btn" id="title-review-back-btn" type="button">←</button>
      <h1 class="view-title">Review Suggested Titles</h1>
    </div>
    <div id="title-review-list"></div>
  </div>
```

Add immediately after it:

```html

  <div id="view-content-ideas" style="display:none; padding: 0 10px">
    <div class="back-row">
      <button class="back-btn" id="content-ideas-back-btn" type="button">←</button>
      <h1 class="view-title">Content Ideas</h1>
    </div>
    <div id="content-ideas-list"></div>
  </div>
```

- [ ] **Step 2: Add the home-screen link**

Find:

```html
    <button id="title-review-link" onclick="showTitleReview()" style="display:none; width:100%; margin-bottom:16px; padding:10px; border-radius:10px; border:1px solid rgba(255,193,7,0.3); background:rgba(255,193,7,0.08); color:#FFC107; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer;"></button>
```

Add immediately after it:

```html
    <button id="content-ideas-link" onclick="showContentIdeas()" style="display:none; width:100%; margin-bottom:16px; padding:10px; border-radius:10px; border:1px solid rgba(255,193,7,0.3); background:rgba(255,193,7,0.08); color:#FFC107; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer;"></button>
```

- [ ] **Step 3: Add the count check to `renderHome`**

Find:

```js
      const reviewLink = document.getElementById('title-review-link');
      if (pendingCount > 0) {
        reviewLink.style.display = '';
        reviewLink.textContent = 'Review ' + pendingCount + ' suggested title' + (pendingCount === 1 ? '' : 's') + ' →';
      } else {
        reviewLink.style.display = 'none';
      }
```

Add immediately after it:

```js

      const contentIdeasCount = HypeAudio.listActiveClips().filter(HypeAudio.hasPendingContentIdea).length;
      const contentIdeasLink = document.getElementById('content-ideas-link');
      if (contentIdeasCount > 0) {
        contentIdeasLink.style.display = '';
        contentIdeasLink.textContent = contentIdeasCount + ' rant' + (contentIdeasCount === 1 ? '' : 's') + ' ready for content →';
      } else {
        contentIdeasLink.style.display = 'none';
      }
```

- [ ] **Step 4: Add the view toggle to the 4 existing nav functions**

`view-content-ideas` needs to be explicitly hidden in `showHome`, `showSubcats`, and `showSection` (all three have the literal line `document.getElementById('view-title-review').style.display = 'none';` — add `document.getElementById('view-content-ideas').style.display = 'none';` immediately after it in each). `showTitleReview` is different: it sets `view-title-review` to `''` (itself, visible) rather than `'none'`, so the same find-and-replace text won't match there — it needs its own explicit line instead, or `view-content-ideas` stays stuck visible (`''`) from a previous visit when navigating into Title Review, stacking two views. Four separate edits total:

In `showHome`, `showSubcats`, and `showSection`, find (each occurs once per function):

```js
      document.getElementById('view-title-review').style.display = 'none';
```

Add immediately after it, in all three functions:

```js
      document.getElementById('view-content-ideas').style.display = 'none';
```

In `showTitleReview`, find:

```js
      document.getElementById('view-title-review').style.display = '';
      renderTitleReview();
```

Replace it with:

```js
      document.getElementById('view-title-review').style.display = '';
      document.getElementById('view-content-ideas').style.display = 'none';
      renderTitleReview();
```

- [ ] **Step 5: Add `showContentIdeas` and `renderContentIdeas`**

Find `renderTitleReview`'s closing brace (the `}` immediately before `function showSection(key, mentality) {`):

```js
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    function showSection(key, mentality) {
```

Replace it with:

```js
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    function showContentIdeas() {
      if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();
      currentPillar = null;
      currentMentality = null;
      document.getElementById('view-home').style.display = 'none';
      document.getElementById('view-subcat').style.display = 'none';
      document.getElementById('view-section').style.display = 'none';
      document.getElementById('view-title-review').style.display = 'none';
      document.getElementById('view-content-ideas').style.display = '';
      renderContentIdeas();
      renderTabbar();
    }

    const CONTENT_IDEA_PILLARS = ['mindset', 'training', 'life', 'faith', 'diet'];

    function renderContentIdeas() {
      const list = document.getElementById('content-ideas-list');
      const pending = HypeAudio.listActiveClips().filter(HypeAudio.hasPendingContentIdea);
      list.innerHTML = pending.length ? '' : '<div class="empty-state">No rants ready for content yet.</div>';
      pending.forEach(function (clip) {
        const row = document.createElement('div');
        row.className = 'clip';
        row.style.flexDirection = 'column';
        row.style.alignItems = 'stretch';

        const preview = document.createElement('div');
        preview.className = 'clip-quote';
        preview.textContent = '"' + (HypeAudio.quotePreview(clip, 200) || '') + '"';
        row.appendChild(preview);

        const titleField = document.createElement('div');
        titleField.className = 'field';
        titleField.innerHTML = '<label>Title</label>';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = clip.title || '';
        titleField.appendChild(titleInput);
        row.appendChild(titleField);

        const hookField = document.createElement('div');
        hookField.className = 'field';
        hookField.innerHTML = '<label>Hook</label>';
        const hookInput = document.createElement('input');
        hookInput.type = 'text';
        hookInput.placeholder = 'The line that stops the scroll';
        hookField.appendChild(hookInput);
        row.appendChild(hookField);

        const pillarField = document.createElement('div');
        pillarField.className = 'field';
        pillarField.innerHTML = '<label>Pillar</label>';
        const pillarSelect = document.createElement('select');
        CONTENT_IDEA_PILLARS.forEach(function (p) {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
          if (p === 'mindset') opt.selected = true;
          pillarSelect.appendChild(opt);
        });
        pillarField.appendChild(pillarSelect);
        row.appendChild(pillarField);

        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.textContent = 'Send to Content Ideas';
        sendBtn.style.marginTop = '10px';
        sendBtn.style.padding = '10px';
        sendBtn.style.border = '0';
        sendBtn.style.borderRadius = '10px';
        sendBtn.style.background = 'linear-gradient(135deg, #F0524E 0%, var(--iron) 100%)';
        sendBtn.style.color = '#0a0a0a';
        sendBtn.style.fontFamily = 'inherit';
        sendBtn.style.fontWeight = '700';
        sendBtn.style.cursor = 'pointer';
        sendBtn.onclick = async function () {
          sendBtn.disabled = true;
          const prevLabel = sendBtn.textContent;
          sendBtn.textContent = 'Sending…';
          try {
            const result = await HypeAudio.sendToContentIdea(clip, {
              title: titleInput.value.trim() || clip.title,
              hook: hookInput.value.trim(),
              pillar: pillarSelect.value,
              body: clip.transcript_text,
            });
            if (!result.id) { alert(result.error || 'Failed to send.'); return; }
            HypeAudio.updateClip(clip.id, { content_idea_sent: true });
            renderContentIdeas();
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = prevLabel;
          }
        };
        row.appendChild(sendBtn);

        list.appendChild(row);
      });
    }

    function showSection(key, mentality) {
```

- [ ] **Step 6: Wire the back button**

Find:

```js
    document.getElementById('title-review-back-btn').onclick = function () { showHome(); };
```

Add immediately after it:

```js
    document.getElementById('content-ideas-back-btn').onclick = function () { showHome(); };
```

- [ ] **Step 7: Run the full selfcheck suite as a regression check**

Run: `node hype-audio.selfcheck.js && node sync.selfcheck.js && node sw.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: all three print `all assertions passed`

- [ ] **Step 8: Verify live in browser**

Using the Claude_Browser MCP tools (`hype-audio` preview, port 5557):

1. `preview_start` with `{name: "hype-audio"}`.
2. Via `javascript_tool`, temporarily mark one real `carl`-pillar clip as eligible for this test: find a clip with `pillar === 'carl'`, call `HypeAudio.updateClip(<its id>, { transcript_text: 'Test transcript for live verification.' })`.
3. Reload, confirm the home screen shows a "1 rant ready for content →" link (or higher if other real clips already have transcripts by then).
4. Tap it — confirm the Content Ideas screen shows the clip with the transcript preview, editable Title/Hook/Pillar fields.
5. Type a hook, tap "Send to Content Ideas" — if prompted for a passphrase, confirm the real `HYPE_AUDIO_UPLOAD_SECRET` value works (401 on a wrong guess, matching the existing upload flow's behavior).
6. Confirm the row disappears from the queue after sending (re-render reflects `content_idea_sent: true`).
7. Query Supabase directly (via the Supabase MCP tools) to confirm the new `content_ideas` row landed with the expected `title`/`hook`/`pillar`/`body`/`notes`, then delete that test row (`delete from content_ideas where id = '<the returned id>'`) so it doesn't pollute the real 211-row content pipeline.
8. Clear the test clip's `transcript_text`/`content_idea_sent` back to their original state (`HypeAudio.updateClip(<its id>, { transcript_text: null, content_idea_sent: null })`) so the real transcription script (Task 5) starts from a clean slate.
9. `read_console_messages` with `onlyErrors: true` — confirm no new errors.

- [ ] **Step 9: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add index.html
git commit -m "feat(rant-engine): add Content Ideas review screen"
```

---

### Task 5: `scripts/transcribe-carl-rants.py`

**Files:**
- Create: `C:\Users\gregm\hype-audio-app\scripts\transcribe-carl-rants.py`

- [ ] **Step 1: Create the script**

```python
# Transcribes carl-pillar hype-audio clips missing transcript_text, using
# local Whisper (zero API cost). Adapted from instagram-cleanup's
# fetch-missing-transcripts.py, with two differences: joins on the clip's
# stable `id` (not the old title-slug hack), and does NOT exclude the carl
# mentality -- that exclusion is exactly the gap this script closes.
# See docs/superpowers/specs/2026-08-17-rant-engine-design.md.
#
# Push-back uses the plain anon/publishable key, not the service-role key --
# app_state's RLS already grants anon read/write for key='hype-audio'
# (confirmed live), matching hype-audio-app/scripts/update-existing-clips.js.
import json
import subprocess
import tempfile
import urllib.request
from pathlib import Path

SUPABASE_URL = "https://vikpcejlyxieguorwysf.supabase.co"
SUPABASE_KEY = "sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv"
APP_KEY = "hype-audio"

HERE = Path(__file__).parent
TRANSCRIPT_DIR = HERE / "carl-rant-transcripts"
TRANSCRIPT_DIR.mkdir(exist_ok=True)


def fetch_json(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    headers = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}
    row = fetch_json(
        f"{SUPABASE_URL}/rest/v1/app_state?key=eq.{APP_KEY}&select=data",
        headers,
    )
    if not row:
        print("No app_state row found for key=hype-audio.")
        return
    clips = row[0]["data"]["hype_audio"]

    missing = [
        c for c in clips
        if c.get("pillar") == "carl"
        and not c.get("deleted")
        and not (c.get("transcript_text") or "").strip()
    ]
    print(f"{len(missing)} carl clips missing transcript_text")

    ok, err = 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for i, clip in enumerate(missing, 1):
            clip_id = clip["id"]
            url = clip.get("storage_url")
            if not url:
                print(f"  [{i}/{len(missing)}] {clip_id} -> no storage_url, skipping")
                err += 1
                continue

            out_json = TRANSCRIPT_DIR / f"{clip_id}.json"
            if not out_json.exists():
                audio_path = tmp_path / f"{clip_id}.mp3"
                try:
                    urllib.request.urlretrieve(url, audio_path)
                except Exception as e:
                    print(f"  [{i}/{len(missing)}] {clip_id} -> download error: {str(e)[:100]}")
                    err += 1
                    continue

                subprocess.run(
                    ["whisper", str(audio_path), "--model", "base", "--output_format", "json",
                     "--output_dir", str(TRANSCRIPT_DIR), "--fp16", "False"],
                    capture_output=True, text=True, timeout=180,
                )
                # whisper names its output after the input file's stem
                produced = TRANSCRIPT_DIR / f"{audio_path.stem}.json"
                if produced.exists() and produced != out_json:
                    produced.rename(out_json)

            if not out_json.exists():
                print(f"  [{i}/{len(missing)}] {clip_id} -> transcription failed")
                err += 1
                continue

            transcript = json.loads(out_json.read_text(encoding="utf-8"))["text"].strip()
            clip["transcript_text"] = transcript
            ok += 1
            if i % 5 == 0:
                print(f"  [{i}/{len(missing)}] done")

    if ok > 0:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/app_state?on_conflict=key",
            data=json.dumps({"key": APP_KEY, "data": {"hype_audio": clips}}).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
            method="POST",
        )
        urllib.request.urlopen(req)

    print(f"\nDone. {ok} transcribed, {err} errors.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify Whisper is installed**

Run: `whisper --help`
Expected: prints Whisper's CLI help text. If this fails with "command not found," stop and report to Carl — Whisper needs to already be installed locally (it has been, per this repo's other transcription scripts) before this script can run; installing it is out of scope for this plan.

- [ ] **Step 3: Test-run against a small real subset**

Temporarily edit the script's `missing = [...]` line to add `[:2]` (`missing = [c for c in clips if ...][:2]`) for this verification run only, so it processes 2 real clips instead of the full backlog. Run:

```bash
cd C:\Users\gregm\hype-audio-app\scripts
python transcribe-carl-rants.py
```

Expected: prints `2 carl clips missing transcript_text`, then per-clip progress, then `Done. 2 transcribed, 0 errors.` (allow a few minutes — Whisper's `base` model on real audio takes real time, this isn't instant).

- [ ] **Step 4: Confirm the transcripts actually landed in Supabase**

Using the Supabase MCP tools, query the two clip ids processed in Step 3 and confirm `transcript_text` is now non-empty and looks like real speech-to-text output (not garbled/empty).

- [ ] **Step 5: Remove the `[:2]` test-only limit**

Revert the temporary slice from Step 3 so the script processes the full backlog on its next real run — that full run is Carl's to kick off whenever he wants (matches the spec's "one-off script, run when needed"), not part of this plan's automated steps.

- [ ] **Step 6: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add scripts/transcribe-carl-rants.py
git commit -m "feat(rant-engine): add transcribe-carl-rants.py"
```

---

### Task 6: Push, deploy, confirm

**Files:** none (verification only)

No Row sync needed for this feature — nothing in `content_ideas`/transcription touches Row.

- [ ] **Step 1: Push**

```bash
cd C:\Users\gregm\hype-audio-app
git push origin master
```

- [ ] **Step 2: Confirm the Vercel deploy is READY**

Using the Vercel MCP tools: `list_deployments` for project `prj_Yfz9Uz8yxIjIJYtwC1RVEHoshQqE`, team `team_YFOSyD1ZMto3FYzNINBi7fcm` — confirm the newest deployment's `githubCommitSha` matches the latest local commit and `state` is `READY`. If it takes longer than a couple minutes to appear (this happened once already this session — a delayed GitHub webhook, not a build failure), poll the live site directly (`curl -s https://hype-audio-app.vercel.app/index.html | grep -o content-ideas-link`) rather than assuming something is broken.

- [ ] **Step 3: One last live check against production itself**

Confirm `HypeAudio.hasPendingContentIdea` and `HypeAudio.sendToContentIdea` exist on `https://hype-audio-app.vercel.app` (not just localhost) via `javascript_tool`, matching how the state-modes feature's final check was done against the real production URL, not just the dev server.

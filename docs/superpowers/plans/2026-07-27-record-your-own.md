# Record Your Own Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app voice recording to `hype-audio-app`'s Carl pillar section view — record, preview, optionally re-record, then save through the existing upload pipeline as a `pillar:'carl'` clip.

**Architecture:** All changes land in the single existing `index.html` (this app has no build step, no separate JS modules beyond the shared `hype-audio.js`/`sync.js` libs). A new "Record a clip" `<details>` block reuses the existing `uploadClipFile()` + `addClip()` pipeline; the only new logic is a MediaRecorder-based state machine (idle → recording → preview → save), gated on a codec-support check for iOS Safari.

**Tech Stack:** Plain JS (no framework, no build step), MediaRecorder Web API, Supabase Storage (via the existing `uploadClipFile` helper in `hype-audio.js`).

Spec: `docs/superpowers/specs/2026-07-27-record-your-own-design.md`

---

### Task 1: HTML markup for the record UI

**Files:**
- Modify: `index.html:257-281` (insert after the existing "Upload a clip" `<details>` block, inside `view-section`)

- [ ] **Step 1: Add the markup**

Insert this immediately after the closing `</details>` of the existing "Upload a clip" block (right after index.html:281, before the `<div class="section-label">Library</div>` at index.html:283):

```html
    <details id="record-clip-details" style="display:none">
      <summary>Record a clip</summary>
      <div id="record-idle" style="padding: 14px 16px 16px">
        <button type="button" class="record-btn" id="record-start-btn">🎙️ Record</button>
      </div>
      <div id="record-active" style="display:none; padding: 14px 16px 16px; display: flex; align-items: center; gap: 10px;">
        <span id="record-elapsed" style="font-family: var(--font-mono); font-size: 13px; color: var(--text-tertiary);">0:00</span>
        <button type="button" class="record-btn" id="record-stop-btn">⏹ Stop</button>
      </div>
      <div id="record-preview" style="display:none; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px;">
        <audio controls id="record-preview-audio" style="width: 100%"></audio>
        <button type="button" class="record-btn" id="record-rerecord-btn">🔁 Re-record</button>
      </div>
      <form id="record-save-form" style="display:none">
        <div class="field"><label>Title</label><input type="text" id="record-title-input" placeholder="Title" required></div>
        <div class="field"><label>Mentality</label><input type="text" id="record-mentality-input" placeholder="e.g. drive, discipline" required></div>
        <select id="record-moment-input">
          <option value="pre_workout">Pre-workout</option>
          <option value="mid_set">Mid-set</option>
          <option value="post_workout">Post-workout</option>
        </select>
        <select id="record-source-input">
          <option value="personal_use" selected>Personal use only</option>
          <option value="original">Original</option>
          <option value="licensed">Licensed</option>
        </select>
        <button type="submit">Save</button>
      </form>
    </details>
```

Note: `record-active` and `record-preview` each have an inline `display:none` followed immediately by `display: flex` in the same `style` attribute — the later declaration wins in CSS, so both start hidden (matches the other hidden blocks) while defining the flex layout they'll use once shown via JS (`.style.display = ''` doesn't work for these two since they need `flex`, not the default `block` — Task 3's JS sets `.style.display = 'flex'` explicitly for these two, `''` for the plain-`div`/`details` ones).

- [ ] **Step 2: Verify it's present but hidden**

Open `index.html` in a browser (file:// is fine for just checking markup exists — no server needed for this step), open dev tools, confirm `document.getElementById('record-clip-details')` exists and its computed `display` is `none`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(record-your-own): add record UI markup, hidden by default"
```

---

### Task 2: CSS for the record buttons

**Files:**
- Modify: `index.html:137-141` (right after the existing `form button[type="submit"]` rule)

The three `record-btn` buttons (`record-start-btn`, `record-stop-btn`, `record-rerecord-btn`) sit outside any `<form>`, so they don't inherit the existing `form button[type="submit"]` styling — they need their own rule or they'd render as unstyled system-default buttons.

- [ ] **Step 1: Add the CSS**

Insert right after the closing `}` of `form button[type="submit"]` (index.html:141):

```css
  .record-btn {
    padding: 12px 20px; border: 0; border-radius: 12px;
    background: linear-gradient(135deg, #F0524E 0%, var(--iron) 100%);
    color: #0a0a0a; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
  }
```

(Same visual treatment as the existing submit-button gradient, for consistency — this is a new clip-creation action, same weight as "Upload".)

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat(record-your-own): style the record/stop/re-record buttons"
```

---

### Task 3: Recording state machine + capability check

**Files:**
- Modify: `index.html` (new `<script>` content added into the existing main script block, after the `submitClip`/upload-form wiring — see Task 5 for exact anchor once that's in place; for this task, add it as a new self-contained block right before the closing `</script>` of the main script, so it can be tested independently of Task 5's Save handler)

- [ ] **Step 1: Add the capability check, mime-type picker, and state machine**

```js
    // record-your-own: hide the whole block if this browser/context can't
    // actually record (MediaRecorder can exist as a constructor while mic
    // capture itself is unavailable, e.g. some restricted WebViews).
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.getElementById('record-clip-details').remove();
    } else {
      // Prefer a codec Safari actually supports; audio/webm is not reliable on iOS.
      const RECORD_MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
      function pickRecordMimeType() {
        for (const t of RECORD_MIME_CANDIDATES) {
          if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)) return t;
        }
        return ''; // let the browser pick its own default rather than force an unsupported type
      }

      let mediaRecorder = null;
      let recordedChunks = [];
      let recordedBlob = null;
      let recordedUrl = null;
      let recordElapsedInterval = null;
      let recordStartedAt = 0;
      let activeStream = null;

      async function startRecording() {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          alert('Microphone access denied — enable it in your browser/device settings to record a clip.');
          return;
        }
        activeStream = stream;
        recordedChunks = [];
        const mimeType = pickRecordMimeType();
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onerror = function () {
          cancelRecording();
          alert('Recording failed — try again.');
        };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          activeStream = null;
          if (!recordedChunks.length) return; // stopped via cancelRecording, not a real stop-to-preview
          recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
          recordedUrl = URL.createObjectURL(recordedBlob);
          showRecordPreview();
        };
        mediaRecorder.start();
        recordStartedAt = Date.now();
        document.getElementById('record-idle').style.display = 'none';
        document.getElementById('record-active').style.display = 'flex';
        recordElapsedInterval = setInterval(updateRecordElapsed, 250);
      }

      function updateRecordElapsed() {
        const secs = Math.floor((Date.now() - recordStartedAt) / 1000);
        const mins = Math.floor(secs / 60);
        document.getElementById('record-elapsed').textContent = mins + ':' + String(secs % 60).padStart(2, '0');
      }

      function stopRecording() {
        clearInterval(recordElapsedInterval);
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      }

      // Hard-stops and discards without producing a preview -- used when
      // navigating away mid-recording (Task 4) or on a recorder error.
      // Clearing recordedChunks first means onstop's own guard skips showRecordPreview().
      function cancelRecording() {
        clearInterval(recordElapsedInterval);
        recordedChunks = [];
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        else if (activeStream) { activeStream.getTracks().forEach(function (t) { t.stop(); }); activeStream = null; }
        document.getElementById('record-active').style.display = 'none';
        document.getElementById('record-idle').style.display = '';
      }

      function showRecordPreview() {
        document.getElementById('record-active').style.display = 'none';
        document.getElementById('record-preview').style.display = 'flex';
        document.getElementById('record-save-form').style.display = 'flex';
        document.getElementById('record-preview-audio').src = recordedUrl;
      }

      function resetRecordUi() {
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        recordedBlob = null;
        recordedUrl = null;
        document.getElementById('record-preview').style.display = 'none';
        document.getElementById('record-save-form').style.display = 'none';
        document.getElementById('record-idle').style.display = '';
        document.getElementById('record-save-form').reset();
      }

      document.getElementById('record-start-btn').onclick = startRecording;
      document.getElementById('record-stop-btn').onclick = stopRecording;
      document.getElementById('record-rerecord-btn').onclick = resetRecordUi;
    }
```

Note: `mediaRecorder`/`cancelRecording`/etc. are declared inside the `else` block here — Task 4 needs `mediaRecorder` and `cancelRecording` visible from `showHome`/`showSubcats`/`showSection`, which live earlier in the same top-level script (not wrapped in a function), so this whole block must be **plain top-level code, not wrapped in an IIFE** — `let`/`function` declared at the top level of a `<script>` tag are visible to everything else in that same script, regardless of source order, as long as they're not called before this script block has actually run. Since this script tag runs near the end of `<body>`, after `showHome`/`showSubcats`/`showSection` are *defined* (function declarations hoist) but this block's `let mediaRecorder` executes after those functions are declared — by the time a user can actually click a tab (after the page finishes loading), this block has already run. No dead-zone risk in practice.

- [ ] **Step 2: Verify it doesn't throw on page load**

Start the dev server (see Task 6 for `launch.json` setup — if not yet done, run `npx serve -l 5556 .` from `C:\Users\gregm\hype-audio-app` directly for this quick check) and open the page. Check the browser console for errors. Expected: no errors, `record-clip-details` still hidden (pillar is `null`/home by default, not yet `'carl'`).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(record-your-own): MediaRecorder state machine + capability check"
```

---

### Task 4: Visibility toggle + navigation-away cleanup

**Files:**
- Modify: `index.html:487-516` (`showHome`, `showSubcats`, `showSection`, `renderSection`)

- [ ] **Step 1: Add the visibility toggle to `renderSection`**

`renderSection(key, mentality)` (index.html:518) has an early `return` at index.html:542 when the pillar/mentality combo has zero clips — the toggle must land before that. Add it right after the existing header updates (index.html:519-524):

```js
    function renderSection(key, mentality) {
      const meta = PILLARS[key];
      document.getElementById('section-title').textContent = meta.label + ' · ' + mentalityLabel(mentality);
      document.getElementById('section-title').style.color = meta.color;
      document.getElementById('pillar-input').value = key;
      document.getElementById('mentality-input').value = mentality;
      document.getElementById('page-bg').style.backgroundImage = "url('" + mentalityArt(mentality) + "')";
      const recordDetails = document.getElementById('record-clip-details');
      if (recordDetails) recordDetails.style.display = key === 'carl' ? '' : 'none';
```

(`recordDetails` is looked up with a null-check because Task 3 may have `.remove()`'d it entirely on a browser with no MediaRecorder support — this line must not throw in that case.)

- [ ] **Step 2: Add mic-release cleanup to the three nav functions**

Replace `showHome`, `showSubcats`, `showSection` (index.html:487-516) with:

```js
    function showHome() {
      if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();
      currentPillar = null;
      currentMentality = null;
      document.getElementById('view-home').style.display = '';
      document.getElementById('view-subcat').style.display = 'none';
      document.getElementById('view-section').style.display = 'none';
      document.getElementById('page-bg').style.backgroundImage = "url('images/home/hero-combo.png')";
      renderHome();
      renderTabbar();
    }

    function showSubcats(key) {
      if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();
      currentPillar = key;
      currentMentality = null;
      document.getElementById('view-home').style.display = 'none';
      document.getElementById('view-subcat').style.display = '';
      document.getElementById('view-section').style.display = 'none';
      renderSubcats(key);
      renderTabbar();
    }

    function showSection(key, mentality) {
      if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();
      currentPillar = key;
      currentMentality = mentality;
      document.getElementById('view-home').style.display = 'none';
      document.getElementById('view-subcat').style.display = 'none';
      document.getElementById('view-section').style.display = '';
      renderSection(key, mentality);
      renderTabbar();
    }
```

(`typeof mediaRecorder !== 'undefined'` guards the case where Task 3's capability check removed the whole recording block and never declared `mediaRecorder` at all — these three nav functions are defined earlier in the script than Task 3's block runs, so referencing `mediaRecorder` directly without the `typeof` guard would be safe by the time a user can actually navigate, but the guard costs nothing and protects against the no-MediaRecorder browser path where the variable never gets declared.)

- [ ] **Step 3: Verify live**

With the dev server running, navigate Home → Carl pillar tab → into a Carl mentality section. Confirm "Record a clip" appears only there, not in any other pillar's section view. Start a recording, then tap a different tab mid-recording — confirm (via browser dev tools' microphone indicator, or `navigator.mediaDevices` if inspectable) that the mic stops being active.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(record-your-own): show record UI only in Carl pillar, release mic on nav-away"
```

---

### Task 5: Save handler

**Files:**
- Modify: `index.html` (add right after the existing `upload-form` submit handler, index.html:659-670ish, inside the same script block as Task 3's recording state machine — the `else` branch, since this handler also references `recordedBlob`)

- [ ] **Step 1: Add the Save form handler**

Add this inside the same `else` block from Task 3 (after the `document.getElementById('record-rerecord-btn').onclick = resetRecordUi;` line):

```js
      document.getElementById('record-save-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const saveBtn = e.target.querySelector('button[type="submit"]');
        saveBtn.disabled = true; // guards against a double-tap firing two uploads for one recording
        try {
          // recordedBlob.type can come back empty or unusual on some browsers --
          // fall back to 'webm' rather than let split('/') produce a bad filename.
          const parts = (recordedBlob.type || '').split('/');
          const ext = (parts[1] || 'webm').split(';')[0] || 'webm';
          const file = new File([recordedBlob], 'recording_' + Date.now() + '.' + ext, { type: recordedBlob.type || 'audio/webm' });
          const url = await HypeAudio.uploadClipFile(file, supa);
          if (!url) { alert('Upload failed.'); return; }
          HypeAudio.addClip({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            title: document.getElementById('record-title-input').value,
            mentality: document.getElementById('record-mentality-input').value,
            pillar: 'carl',
            moment: document.getElementById('record-moment-input').value,
            source_type: document.getElementById('record-source-input').value,
            storage_url: url,
            created_at: new Date().toISOString(),
            play_count: 0,
          });
          resetRecordUi();
          renderSection(currentPillar, currentMentality);
        } finally {
          saveBtn.disabled = false;
        }
      });
```

- [ ] **Step 2: Verify live end-to-end**

With the dev server running: navigate to a Carl-pillar mentality section, tap Record, speak for a few seconds, tap Stop, confirm the preview `<audio>` plays back what you said, fill in Title/Mentality, tap Save. Confirm: the form resets to idle, the new clip appears in the clip list below with the right title/mentality/pillar (`carl`)/moment/source, and tapping its play button in the normal clip-list player actually plays it back correctly (not just the local preview).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(record-your-own): wire Save to the existing upload pipeline"
```

---

### Task 6: Dev server config + full live verification

**Files:**
- Create: `.claude/launch.json` (this repo doesn't have one yet — Row's is the template)

- [ ] **Step 1: Create the launch config**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "hype-audio-app",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["serve", "-l", "5556", "."],
      "port": 5556
    }
  ]
}
```

(Port `5556`, not `5555` — Row already uses `5555` and both dev servers may run in the same session.)

- [ ] **Step 2: Full live-verification pass**

Using the Browser pane's `preview_start` with `{name: "hype-audio-app"}`:

1. Record → Stop → preview plays back correctly → Re-record → confirm it discards and returns to the idle "🎙️ Record" state (not stuck on the old preview).
2. Record → Stop → Save with a `mid_set` moment selected → confirm the new clip's `moment` is actually `mid_set` (this is a real way to fill the currently-empty `mid_set`/`post_workout` pools from the Row fusion feature).
3. Record, then switch to a different pillar tab mid-recording → confirm the mic stops (no lingering active `MediaStream`).
4. Resize to mobile width (375px) — confirm the record UI's buttons/preview player don't overflow the card.
5. Confirm the existing "Upload a clip" form (file-based) still works unaffected in a non-Carl pillar.

- [ ] **Step 3: Commit**

```bash
git add .claude/launch.json
git commit -m "chore(record-your-own): add local dev server config for browser verification"
```

---

### Task 7: On-device verification reminder + final push

**Files:** none (verification + repo-level)

- [ ] **Step 1: Confirm all prior task commits are in place**

```bash
git log --oneline -8
```

Expected: the 6 feature/config commits from Tasks 1-6, most-recent-first.

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Flag the on-device check**

Per the spec's Testing section and Codex's review: browser dev-tools testing in this session can't fully substitute for the installed Home Screen PWA on Carl's actual phone — mic-permission behavior and `getUserMedia` can differ in standalone iOS PWA mode vs. a regular Safari tab. Tell Carl this needs one real end-to-end recording on his phone before it's fully verified, since that's not something achievable from this session's browser tooling.

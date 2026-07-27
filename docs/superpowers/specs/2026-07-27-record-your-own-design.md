# Record Your Own — In-App Voice Recording

Date: 2026-07-27
Status: Approved, ready for planning

## Context

Fourth item on the hype-audio vision batch (Fable brainstorm, 2026-07-26; items #1-3 already shipped: gym-proof playback, moment modes, Row rest-timer/PR fusion). HANDOFF's wording: "record-your-own in-app (MediaRecorder → Carl pillar, dual-purpose as content-pipeline raw material)."

Scoped down from that wording during brainstorming: this build is **MVP only** — record a voice clip in-app, save it as a normal `pillar:'carl'` hype-audio clip through the existing upload pipeline. The "dual-purpose as content-pipeline raw material" half of the original vision (feeding Content Manager) is explicitly out of scope for this pass — Carl's call, can revisit later.

This only touches the standalone `hype-audio-app` repo (`C:\Users\gregm\hype-audio-app`, `index.html`). Row (`gym.html`) has no upload UI at all today — it's playback-only there — so nothing in Row changes.

### Existing pipeline this reuses

`index.html`'s section view (`view-section`, shown via `showSection(key, mentality)` → `renderSection(key, mentality)`, index.html:508-524) already has an "Upload a clip" `<details>` form (index.html:257-281): file input + Title/Mentality/Pillar/Moment/Source fields → `submitClip()` (index.html:641-657) → `HypeAudio.uploadClipFile(file, supa)` (uploads to Supabase Storage, returns a public URL) → `HypeAudio.addClip({...})` (writes the clip's metadata + that URL to the local `hype_audio` list, which syncs to Supabase via the existing `sync.js`/`initCloudSync` mechanism already wired into this page).

`uploadClipFile(file, supa)` (hype-audio.js:349-358) reads `file.name` and `file.type` to build the storage path — a raw `MediaRecorder` Blob has neither, so it must be wrapped in a real `File` object (`new File([blob], filename, { type: blob.type })`) before being passed in. No changes needed to `uploadClipFile` itself.

## Decisions from brainstorming

- **Pillar**: always `'carl'`, no picker — this feature exists specifically for Carl's own voice/rants. The section view's existing Pillar select is skipped entirely for recordings (it stays as-is for the existing file-upload form).
- **Entry point**: the new "Record a clip" `<details>` block only shows when `currentPillar === 'carl'` — i.e. only reachable from inside the Carl pillar's section view, not a global/home-screen button.
- **Save flow**: recording is local-only (an in-memory Blob + a preview player) until Carl explicitly taps Save. A bad take gets discarded via "Re-record," not by deleting an already-uploaded clip afterward. Nothing touches Supabase before the Save tap.
- **Moment field stays selectable** (not hardcoded) even though pillar is hardcoded — this is a real opportunity to fill the currently-empty `mid_set`/`post_workout` clip pools by just talking into the mic, instead of needing pre-recorded audio files for those.

## Design

### 1. New "Record a clip" block

Added as a second `<details>` in `view-section`, right after the existing "Upload a clip" one:

```html
<details id="record-clip-details" style="display:none">
  <summary>Record a clip</summary>
  <div id="record-idle">
    <button type="button" id="record-start-btn">🎙️ Record</button>
  </div>
  <div id="record-active" style="display:none">
    <span id="record-elapsed">0:00</span>
    <button type="button" id="record-stop-btn">⏹ Stop</button>
  </div>
  <div id="record-preview" style="display:none">
    <audio controls id="record-preview-audio"></audio>
    <button type="button" id="record-rerecord-btn">🔁 Re-record</button>
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

Four states, one visible at a time (`record-idle` → `record-active` → `record-preview` + `record-save-form` together → back to `record-idle` after save or on re-record). Source defaults to `personal_use`, matching the convention already used on real `pillar:'carl'` clips in this dataset today.

### 2. Visibility toggle

`renderSection(key, mentality)` (index.html:518) has an early `return` at index.html:542 when the pillar/mentality combo has zero clips — the toggle must land before that, not after. Add it right after the other unconditional header updates (index.html:519-524, section-title/pillar-input/mentality-input/page-bg), before the `randomBtn`/`clip-list` logic:

```js
document.getElementById('record-clip-details').style.display = key === 'carl' ? '' : 'none';
```

### 3. Recording state machine

Codex's `luna` review (2026-07-27) flagged real iOS Safari gaps in the first draft — Carl's primary device, and this repo already hit a Safari-specific audio bug once before (the Range-header caching issue from the gym-proof-playback build). Folded in below: pick a codec Safari actually supports via `MediaRecorder.isTypeSupported()` instead of defaulting to `audio/webm` (unreliable on iOS), handle recorder/track errors instead of leaving the UI stuck mid-recording, and stop+release the mic if Carl navigates away mid-recording (otherwise the mic silently keeps running).

```js
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
    showPreview();
  };
  mediaRecorder.start();
  recordStartedAt = Date.now();
  document.getElementById('record-idle').style.display = 'none';
  document.getElementById('record-active').style.display = '';
  recordElapsedInterval = setInterval(updateElapsed, 250);
}

function updateElapsed() {
  const secs = Math.floor((Date.now() - recordStartedAt) / 1000);
  const mins = Math.floor(secs / 60);
  document.getElementById('record-elapsed').textContent = mins + ':' + String(secs % 60).padStart(2, '0');
}

function stopRecording() {
  clearInterval(recordElapsedInterval);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

// Hard-stops and discards without producing a preview -- used when
// navigating away mid-recording (see nav hook below) or on a recorder error.
// Clearing recordedChunks first means onstop's own guard skips showPreview().
function cancelRecording() {
  clearInterval(recordElapsedInterval);
  recordedChunks = [];
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  else if (activeStream) { activeStream.getTracks().forEach(function (t) { t.stop(); }); activeStream = null; }
  document.getElementById('record-active').style.display = 'none';
  document.getElementById('record-idle').style.display = '';
}

function showPreview() {
  document.getElementById('record-active').style.display = 'none';
  document.getElementById('record-preview').style.display = '';
  document.getElementById('record-save-form').style.display = '';
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
```

**Navigation-away cleanup:** `showHome()`, `showSubcats(key)`, and `showSection(key, mentality)` (index.html:488, 498, 508) are the three places that switch views. Add one line at the top of each — `if (mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();` — so leaving the Carl pillar's section view mid-recording actually releases the mic instead of leaving it running silently behind a now-hidden `<details>` block.

### 4. Save — reuses the existing upload pipeline

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

This is the same shape `submitClip()` already builds (index.html:641-657) — a near-duplicate rather than a shared helper, because `submitClip()` reads its file from a real `<input type="file">` (`fileInput.files[0]`) while this path already has an in-memory `File` object; forcing them through one function would mean threading a fake file-input-like shim through the existing helper for no real benefit at this size. `renderSection` re-render at the end refreshes the clip list to show the new recording immediately.

### 5. No-MediaRecorder / no-mic fallback

At the top of the script, alongside other capability checks already in this file (e.g. the existing service-worker registration guard). Checks both `MediaRecorder` and `navigator.mediaDevices.getUserMedia` — `MediaRecorder` can exist as a constructor while mic capture itself is unavailable (older WebViews, some privacy-restricted contexts):

```js
if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  document.getElementById('record-clip-details').remove();
}
```

Runs once at load; if either capability is missing, the whole block is removed rather than left half-broken. The existing "Upload a clip" form is unaffected either way. (This app is already served over HTTPS in production and via `npx serve` locally, both secure contexts `getUserMedia` requires — no new deployment concern here.)

## Testing

No new pure logic worth a dedicated `*.selfcheck.js` test — everything here is DOM/MediaRecorder glue that needs a real browser and microphone, which a Node selfcheck can't provide (matches this repo's existing convention: browser-only features like the Media Session lock-screen controls from the gym-proof-playback build weren't selfcheck-tested either, only live-verified). Verify live in the dev server: record → stop → preview plays back → re-record discards and restarts → Save actually uploads and the new clip appears in the Carl pillar's list with the right pillar/mentality/moment/source. Also verify navigating away mid-recording actually releases the mic (no lingering "recording" indicator), and a recording started, stopped, and saved actually plays back correctly afterward through the normal clip-list player, not just the local preview.

Per Codex's review: browser dev-tools testing can't fully substitute for the installed Home Screen PWA on Carl's actual device — mic-permission behavior and `getUserMedia` can differ in standalone iOS PWA mode vs. a regular Safari tab. Carl should do at least one real end-to-end recording on his phone (not just in this session's browser check) before calling this fully verified.

## Out of scope (this spec)

- Feeding recordings into the separate Content Manager pipeline ("dual-purpose as content-pipeline raw material" from the original vision note) — Carl's call to revisit later, not part of this MVP.
- A hard recording-duration cap — Carl controls when to stop, no timeout.
- Capturing `duration_seconds` metadata on recorded clips — optional field on the existing schema, not read by any playback logic, skipped for this MVP.
- The remaining 5th vision-batch item (transcript layer).

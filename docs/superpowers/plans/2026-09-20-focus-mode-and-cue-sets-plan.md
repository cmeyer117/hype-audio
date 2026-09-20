# Focus Mode + Personal Cue Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Focus session (audio or silence, timed, no random speech) and a personal instructional-cue quick-play row, plus minimal event logging for both.

**Architecture:** Extend `pickRandom`'s filter with `useCase`/`deliveryRole`, extend `logHypeEvent` with an optional `extra` param, add two new UI rows/panels to `index.html`'s existing `view-home`. No new files, no new backend, no new page.

**Tech Stack:** Plain HTML/CSS/JS, no build step. `hype-audio.selfcheck.js` (assert-based, run via `node`) is this repo's test convention.

**Full design:** `docs/superpowers/specs/2026-09-20-focus-mode-and-cue-sets-design.md`

---

### Task 1: `pickRandom` filter extension — `useCase` / `deliveryRole`

**Files:**
- Modify: `hype-audio.js`
- Modify: `hype-audio.selfcheck.js`

- [ ] **Step 1: Read `pickRandom` in full** (`hype-audio.js:56-90` as of this plan's writing) to confirm the exact current filter predicate before editing.

- [ ] **Step 2: Write the failing self-check assertions**

Add to `hype-audio.selfcheck.js`, near the existing pickRandom pillar-filter tests:

```js
// pickRandom with useCase/deliveryRole (item: Focus mode + cue sets)
HypeAudio.addClip({ id: 'focus1', title: 'Rain', mentality: 'ambient', pillar: 'iron', use_case: 'study_focus', delivery_role: 'noise', play_count: 0 });
HypeAudio.addClip({ id: 'focus2', title: 'Hype Speech', mentality: 'goggins', pillar: 'mindset', use_case: 'study_focus', delivery_role: 'motivational_speech', play_count: 0 });
assertEqual(HypeAudio.pickRandom({ useCase: 'study_focus', deliveryRole: ['instrumental', 'noise', 'silence_baseline'] }).id, 'focus1', 'pickRandom(useCase+deliveryRole) excludes a study_focus clip whose delivery_role is not in the list');
assertEqual(HypeAudio.pickRandom({ useCase: 'nonexistent-use-case' }), null, 'pickRandom(useCase) returns null when nothing matches');
assertEqual(HypeAudio.pickRandom({ deliveryRole: ['instructional_cue'] }), null, 'pickRandom(deliveryRole) alone excludes clips with no matching delivery_role among focus1/focus2');

// pickRandom with mentality+deliveryRole (cue sets)
HypeAudio.addClip({ id: 'cue1', title: 'Brace cue', mentality: 'brace', pillar: 'carl', delivery_role: 'instructional_cue', play_count: 0 });
assertEqual(HypeAudio.pickRandom({ mentality: 'brace', deliveryRole: ['instructional_cue'] }).id, 'cue1', 'pickRandom(mentality+deliveryRole) finds the matching cue clip');
assertEqual(HypeAudio.pickRandom({ mentality: 'brace', deliveryRole: ['motivational_speech'] }), null, 'pickRandom(mentality+deliveryRole) excludes a mentality match with the wrong delivery_role');
```

- [ ] **Step 3: Run, confirm failure**

```bash
cd /c/Users/gregm/hype-audio-app && node hype-audio.selfcheck.js
```

Expected: FAIL on the first new assertion (`useCase`/`deliveryRole` aren't filtered on yet, so `pickRandom` returns an arbitrary match from the whole unfiltered pool instead of `null`/`focus1`).

- [ ] **Step 4: Implement**

In `hype-audio.js`, in `pickRandom`'s non-stateMode branch (the `else` block building `pool`), add the two new predicates:

```js
} else {
  const pillars = Array.isArray(filter.pillar) ? filter.pillar : (filter.pillar ? [filter.pillar] : null);
  const deliveryRoles = Array.isArray(filter.deliveryRole) ? filter.deliveryRole : (filter.deliveryRole ? [filter.deliveryRole] : null);
  pool = listActiveClips().filter((c) =>
    (!filter.mentality || c.mentality === filter.mentality) &&
    (!filter.moment || c.moment === filter.moment) &&
    (!pillars || pillars.indexOf(c.pillar) !== -1) &&
    (!filter.useCase || c.use_case === filter.useCase) &&
    (!deliveryRoles || deliveryRoles.indexOf(c.delivery_role) !== -1)
  );
}
```

- [ ] **Step 5: Run, confirm pass**

```bash
cd /c/Users/gregm/hype-audio-app && node hype-audio.selfcheck.js
```

Expected: no `FAIL` lines printed, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat: pickRandom filters by useCase/deliveryRole -- backs Focus mode + cue sets"
```

---

### Task 2: `logHypeEvent` — optional `extra` param

**Files:**
- Modify: `hype-audio.js`
- Modify: `hype-audio.selfcheck.js`

- [ ] **Step 1: Read `logHypeEvent` in full** (`hype-audio.js:741-761` as of this plan's writing).

- [ ] **Step 2: Write the failing self-check assertions**

```js
// logHypeEvent extra param (Focus mode / cue sets measurement)
HypeAudio.logHypeEvent('play', { id: 'focus1', pillar: 'iron', mentality: 'ambient' }, { useCase: 'study_focus', deliveryRole: 'noise', sessionId: 'sess-1' });
const focusLoggedEvent = HypeAudio.listHypeEvents().find((e) => e.clipId === 'focus1' && e.type === 'play');
assertEqual(focusLoggedEvent.useCase, 'study_focus', 'logHypeEvent records useCase from the extra param');
assertEqual(focusLoggedEvent.deliveryRole, 'noise', 'logHypeEvent records deliveryRole from the extra param');
assertEqual(focusLoggedEvent.sessionId, 'sess-1', 'logHypeEvent records sessionId from the extra param');

// Existing callers with no extra param keep working unchanged
HypeAudio.logHypeEvent('play', { id: '1', pillar: undefined, mentality: 'goggins' });
const plainEvent = HypeAudio.listHypeEvents().find((e) => e.clipId === '1' && e.type === 'play');
assertEqual(plainEvent.useCase, null, 'logHypeEvent defaults useCase to null when extra is omitted');

// focus_session_outcome -- no clip involved
HypeAudio.logFocusSessionOutcome({ sessionId: 'sess-1', durationMinutes: 25, sound: 'audio', outcome: 'yes' });
const outcomeEvent = HypeAudio.listHypeEvents().find((e) => e.type === 'focus_session_outcome');
assertEqual(outcomeEvent.sessionId, 'sess-1', 'logFocusSessionOutcome records sessionId');
assertEqual(outcomeEvent.outcome, 'yes', 'logFocusSessionOutcome records outcome');
```

- [ ] **Step 3: Run, confirm failure**

```bash
cd /c/Users/gregm/hype-audio-app && node hype-audio.selfcheck.js
```

Expected: FAIL — `extra` isn't read yet, `logFocusSessionOutcome` doesn't exist.

- [ ] **Step 4: Implement**

In `hype-audio.js`, change `logHypeEvent`'s signature and pushed event shape:

```js
function logHypeEvent(type, clip, extra) {
  try {
    extra = extra || {};
    var now = Date.now();
    var events = listHypeEvents().filter(function (e) {
      return e && typeof e.at === 'number' && e.at <= now && (now - e.at) <= EVENT_RETENTION_MS;
    });
    events.push({
      id: clip.id + '|' + type + '|' + now,
      type: type,
      clipId: clip.id,
      pillar: clip.pillar || null,
      mentality: clip.mentality || null,
      useCase: extra.useCase || null,
      deliveryRole: extra.deliveryRole || null,
      sessionId: extra.sessionId || null,
      at: now,
      updated_at: now,
    });
    if (events.length > EVENT_MAX_COUNT) {
      events = events.slice(events.length - EVENT_MAX_COUNT);
    }
    localStorage.setItem(EVENTS_LS_KEY, JSON.stringify(events));
  } catch (e) {}
}

// No clip is associated with a focus-session outcome (especially Silence
// mode, or a Skip with nothing played) -- logged directly rather than
// forcing a fake clip through logHypeEvent's clip-shaped signature.
function logFocusSessionOutcome(data) {
  try {
    var now = Date.now();
    var events = listHypeEvents().filter(function (e) {
      return e && typeof e.at === 'number' && e.at <= now && (now - e.at) <= EVENT_RETENTION_MS;
    });
    events.push({
      id: 'focus_session_outcome|' + data.sessionId + '|' + now,
      type: 'focus_session_outcome',
      sessionId: data.sessionId,
      durationMinutes: data.durationMinutes,
      sound: data.sound,
      outcome: data.outcome,
      at: now,
      updated_at: now,
    });
    if (events.length > EVENT_MAX_COUNT) {
      events = events.slice(events.length - EVENT_MAX_COUNT);
    }
    localStorage.setItem(EVENTS_LS_KEY, JSON.stringify(events));
  } catch (e) {}
}
```

Add `logFocusSessionOutcome: logFocusSessionOutcome,` to both the `window.HypeAudio = {...}` and `module.exports = {...}` object literals near the bottom of the file, alongside the existing `logHypeEvent: logHypeEvent,` line.

- [ ] **Step 5: Run, confirm pass**

```bash
cd /c/Users/gregm/hype-audio-app && node hype-audio.selfcheck.js
```

- [ ] **Step 6: Commit**

```bash
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat: logHypeEvent extra param + logFocusSessionOutcome"
```

---

### Task 3: Cues row

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Read `index.html`'s `moment-row`/`state-mode-row` markup and their rendering JS in full** (`index.html:262-263` and `:586-631` as of this plan's writing) to match the exact button/styling/click-handler pattern.

- [ ] **Step 2: Add the row markup**, in `view-home` right after `state-mode-row`:

```html
<div class="moment-row" id="cues-row"></div>
```

- [ ] **Step 3: Add the rendering + click logic**, in the same script block as the `stateModeRow` rendering (`renderHome` or wherever that block lives — read the surrounding function name first):

```js
const CUES_UI = [
  { key: 'brace', label: 'Brace' },
  { key: 'controlled_eccentric', label: 'Controlled Eccentric' },
  { key: 'final_rep', label: 'Final Rep' },
  { key: 'post_miss_reset', label: 'Post-Miss Reset' },
];
const cuesRow = document.getElementById('cues-row');
cuesRow.innerHTML = '';
CUES_UI.forEach(function (c) {
  const btn = document.createElement('button');
  btn.className = 'moment-btn';
  btn.type = 'button';
  btn.textContent = c.label;
  btn.onclick = function () {
    const clip = HypeAudio.pickRandom({ mentality: c.key, deliveryRole: ['instructional_cue'] });
    if (!clip) {
      alert('No ' + c.label + ' cue recorded yet -- use Record a clip below, mentality: ' + c.key + ', delivery role: Instructional cue.');
      return;
    }
    HypeAudio.playClip(clip);
    HypeAudio.logHypeEvent('play', clip, { useCase: clip.use_case, deliveryRole: clip.delivery_role });
  };
  cuesRow.appendChild(btn);
});
```

- [ ] **Step 4: Manual verification** — open the app (this repo has no dev server config in this session's tooling; use whatever local static-serving method already covers this app, or a plain `npx serve`), confirm the Cues row renders with 4 buttons, tapping one with no matching clip shows the expected alert naming the exact mentality string, and that recording a clip via the existing "Record a clip" form with mentality `brace` + delivery role `Instructional cue` makes the Brace button play it afterward.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Cues quick-play row (Brace/Controlled Eccentric/Final Rep/Post-Miss Reset)"
```

---

### Task 4: Focus mode panel

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Read the existing "Upload a clip"/"Record a clip" `<details>` panels and the record-timer elapsed-display JS in full** (`index.html:274-392` roughly, plus the recording elapsed-time interval logic near the `MediaRecorder` setup) to match the exact `<details>`/button/timer-display conventions.

- [ ] **Step 2: Add the Focus panel markup**, in `view-home` after the `cues-row` div:

```html
<details id="focus-details">
  <summary>Focus</summary>
  <div id="focus-setup" style="padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px;">
    <div class="moment-row" id="focus-duration-row"></div>
    <div class="moment-row" id="focus-sound-row"></div>
    <button type="button" class="record-btn" id="focus-start-btn">Start Focus</button>
  </div>
  <div id="focus-active" style="display:none; padding: 14px 16px 16px; align-items: center; gap: 10px;">
    <span id="focus-remaining" style="font-family: var(--font-mono); font-size: 13px; color: var(--text-tertiary);"></span>
    <button type="button" class="record-btn" id="focus-stop-btn">⏹ Stop</button>
  </div>
  <div id="focus-outcome" style="display:none; padding: 14px 16px 16px; flex-direction: column; gap: 10px;">
    <div style="font-size: 13px; color: var(--text-tertiary);">Did that help you focus?</div>
    <div class="moment-row">
      <button type="button" class="moment-btn" id="focus-outcome-yes">Yes</button>
      <button type="button" class="moment-btn" id="focus-outcome-no">No</button>
      <button type="button" class="moment-btn" id="focus-outcome-skip">Skip</button>
    </div>
  </div>
</details>
```

- [ ] **Step 3: Add the JS**, in the same script block as the record-clip logic (own `<script>` section, not inside `renderHome` since this state doesn't need to survive a re-render the way the moment/state-mode rows do):

```js
(function () {
  let focusDuration = 25; // minutes
  let focusSound = 'audio'; // 'audio' | 'silence'
  let focusSessionId = null;
  let focusTimerInterval = null;
  let focusEndAt = null;
  let focusClip = null; // the clip HypeAudio.playRandomLoop is currently looping, if any

  const DURATIONS = [25, 50];
  const durationRow = document.getElementById('focus-duration-row');
  DURATIONS.forEach(function (d) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'moment-btn' + (d === focusDuration ? ' active' : '');
    btn.textContent = d + ' min';
    btn.onclick = function () {
      focusDuration = d;
      Array.from(durationRow.children).forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    };
    durationRow.appendChild(btn);
  });

  const SOUNDS = [{ key: 'audio', label: 'Audio' }, { key: 'silence', label: 'Silence' }];
  const soundRow = document.getElementById('focus-sound-row');
  SOUNDS.forEach(function (s) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'moment-btn' + (s.key === focusSound ? ' active' : '');
    btn.textContent = s.label;
    btn.onclick = function () {
      focusSound = s.key;
      Array.from(soundRow.children).forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    };
    soundRow.appendChild(btn);
  });

  function formatRemaining(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function endFocusSession() {
    if (focusTimerInterval) { clearInterval(focusTimerInterval); focusTimerInterval = null; }
    if (focusSound === 'audio') { HypeAudio.stopPlayback(); }
    document.getElementById('focus-active').style.display = 'none';
    document.getElementById('focus-outcome').style.display = 'flex';
  }

  function tickFocusTimer() {
    const remaining = focusEndAt - Date.now();
    // Fade the currently-looping clip's volume out over the last 10s --
    // playSingle's own Audio element isn't exposed by HypeAudio's public
    // API, so this reaches it via HypeAudio.getCurrentClip()'s sibling,
    // the module's currentAudio -- not available externally, so instead
    // this only fades what it can control: nothing extra needed, because
    // stopPlayback() at remaining<=0 already ends it; a hard stop instead
    // of a fade is an accepted simplification for v1 (see design spec --
    // "not a new audio-processing chain").
    document.getElementById('focus-remaining').textContent = formatRemaining(remaining);
    if (remaining <= 0) { endFocusSession(); }
  }

  document.getElementById('focus-start-btn').onclick = function () {
    focusSessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    focusEndAt = Date.now() + focusDuration * 60 * 1000;
    document.getElementById('focus-setup').style.display = 'none';
    document.getElementById('focus-outcome').style.display = 'none';
    document.getElementById('focus-active').style.display = 'flex';
    if (focusSound === 'audio') {
      focusClip = HypeAudio.playRandomLoop({ useCase: 'study_focus', deliveryRole: ['instrumental', 'noise', 'silence_baseline'] });
      if (focusClip) {
        HypeAudio.logHypeEvent('play', focusClip, { useCase: 'study_focus', deliveryRole: focusClip.delivery_role, sessionId: focusSessionId });
      } else {
        alert('No study/focus clips tagged instrumental, noise, or silence-baseline yet -- starting silent.');
      }
    }
    tickFocusTimer();
    focusTimerInterval = setInterval(tickFocusTimer, 1000);
  };

  document.getElementById('focus-stop-btn').onclick = function () { endFocusSession(); };

  function finishOutcome(outcome) {
    HypeAudio.logFocusSessionOutcome({
      sessionId: focusSessionId,
      durationMinutes: focusDuration,
      sound: focusSound,
      outcome: outcome,
    });
    document.getElementById('focus-outcome').style.display = 'none';
    document.getElementById('focus-setup').style.display = 'flex';
    document.getElementById('focus-details').removeAttribute('open');
  }

  document.getElementById('focus-outcome-yes').onclick = function () { finishOutcome('yes'); };
  document.getElementById('focus-outcome-no').onclick = function () { finishOutcome('no'); };
  document.getElementById('focus-outcome-skip').onclick = function () { finishOutcome('skip'); };
})();
```

- [ ] **Step 4: Manual verification** — open the app, confirm: Focus panel opens with 25/50 min and Audio/Silence choices (default selections visibly active), Start begins a countdown, Audio mode plays a study_focus/instrumental-or-noise-or-silence-baseline clip on loop (or shows the "no clips yet" alert and continues silently if none exist), Stop ends the session early and shows the Yes/No/Skip prompt, tapping any of the three resets the panel back to setup state. Confirm via `HypeAudio.listHypeEvents()` in the console that a `focus_session_outcome` event was logged with the right `sessionId`/`outcome`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Focus mode panel (25/50 min, Audio/Silence, session outcome prompt)"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the self-check**

```bash
cd /c/Users/gregm/hype-audio-app && node hype-audio.selfcheck.js
```

Expected: no `FAIL` lines, exit code 0.

- [ ] **Step 2: Push**

```bash
git push
```

---

## Notes for the executing agent

- Task order matters: 1 and 2 (hype-audio.js changes) before 3 and 4 (UI wiring that calls the new filter fields/functions).
- Task 4's fade-out is explicitly simplified to a hard stop at timer end (documented inline in the code comment) rather than a real volume ramp — `HypeAudio`'s public API doesn't expose the underlying `Audio` element for external volume control, and adding that plumbing is more than this feature's own scope justifies. If Carl wants a real fade later, that's a small follow-up to `HypeAudio`'s public API, not a re-do of this task.
- If `index.html`'s actual current structure around `moment-row`/`state-mode-row`/the record-clip `<details>` has drifted from what this plan assumes (line numbers, exact class names), match the real file — the goal is "same visual/interaction pattern as the existing rows and panels," not this plan's exact guessed markup.

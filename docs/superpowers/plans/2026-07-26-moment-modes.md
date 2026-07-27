# Moment Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three home-screen buttons (PRE / MID-SET / POST) that start a cross-pillar random loop filtered by the existing `moment` field on clips.

**Architecture:** One small pure-function addition to `hype-audio.js` (`isPlayingMoment`), plus UI wiring in `index.html` (CSS, markup, `renderHome()` logic, and the existing `onPlaybackChange` subscription). No new playback engine logic — `playRandomLoop({ moment: X })` already does everything needed.

**Tech Stack:** Plain JS (no build step, matches existing codebase). Tests follow the existing `*.selfcheck.js` pattern (plain `assert`-based, run with `node`).

**Spec:** `docs/superpowers/specs/2026-07-26-moment-modes-design.md`

---

### Task 1: `isPlayingMoment` pure function + self-check

**Files:**
- Modify: `hype-audio.js`
- Test: `hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing test**

Append to `hype-audio.selfcheck.js` (before the final `console.log` line):

```js
// isPlayingMoment -- distinguishes "random-looping this moment" (home-screen
// PRE/MID-SET/POST buttons) from "a pillar's own PLAY RANDOM", both of
// which share the same randomFilter state.
HypeAudio.addClip({ id: '7', title: 'G', mentality: 'worship', pillar: 'faith', moment: 'pre_workout', play_count: 0 });
HypeAudio.playRandomLoop({ moment: 'pre_workout' });
assertEqual(HypeAudio.isPlayingMoment('pre_workout'), true, 'isPlayingMoment is true for the moment currently looping');
assertEqual(HypeAudio.isPlayingMoment('mid_set'), false, 'isPlayingMoment is false for a different moment');

HypeAudio.playRandomLoop({ pillar: 'faith' });
assertEqual(HypeAudio.isPlayingMoment('pre_workout'), false, 'isPlayingMoment is false when the active random loop is pillar-scoped, not moment-scoped, even if a matching clip happens to have that moment');

HypeAudio.stopPlayback();
assertEqual(HypeAudio.isPlayingMoment('pre_workout'), false, 'isPlayingMoment is false once playback is stopped');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node hype-audio.selfcheck.js` (from `C:\Users\gregm\hype-audio-app`)
Expected: `TypeError: HypeAudio.isPlayingMoment is not a function`

- [ ] **Step 3: Implement in `hype-audio.js`**

Add directly below `function isPlayingRandom() { return !!randomFilter; }`:

```js
  // Distinguishes "random-looping this moment" (home-screen PRE/MID-SET/POST
  // buttons) from "a pillar's own PLAY RANDOM" -- both share randomFilter,
  // but a moment-mode call never sets pillar and a pillar's own random loop
  // never sets moment. See docs/superpowers/specs/2026-07-26-moment-modes-design.md.
  function isPlayingMoment(moment) {
    return !!randomFilter && randomFilter.moment === moment && !randomFilter.pillar;
  }
```

- [ ] **Step 4: Export from `window.HypeAudio`**

In the `window.HypeAudio = { ... }` block, add after `isPlayingRandom: isPlayingRandom,`:

```js
      isPlayingMoment: isPlayingMoment,
```

(Not needed in `module.exports` -- that block is for Node-side migration-script consumers, which never touch playback state.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 6: Commit**

```bash
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "Add isPlayingMoment to distinguish moment-mode from pillar-random-mode"
```

---

### Task 2: CSS for the moment-button row

**Files:**
- Modify: `index.html` (styles, right after the existing `.random-play` rules)

- [ ] **Step 1: Add the CSS**

Right after the `.random-play:hover { filter: brightness(1.08); }` rule (around line 103), add:

```css
  .moment-row { display: flex; gap: 10px; margin-bottom: 22px; }
  .moment-btn {
    flex: 1; padding: 14px 8px; border: 1px solid var(--border-strong); border-radius: 12px;
    background: rgba(255,255,255,0.06); color: var(--text-primary); font-family: var(--font); font-weight: 700;
    font-size: 12px; letter-spacing: .04em; text-transform: uppercase; cursor: pointer;
    transition: transform .08s ease, filter .15s ease;
  }
  .moment-btn:active { transform: scale(.98); }
  .moment-btn:hover { filter: brightness(1.08); }
  .moment-btn.active { background: var(--text-primary); color: #0a0a0a; }
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "Add moment-row button styles"
```

---

### Task 3: Home-screen markup + render logic

**Files:**
- Modify: `index.html:203` (view-home markup)
- Modify: `index.html:343` (`renderHome()`)

- [ ] **Step 1: Add the container markup**

In `<div id="view-home">`, right after the pillar tiles container:

```html
    <div class="tiles" id="tiles"></div>
    <div class="moment-row" id="moment-row"></div>
```

So the block reads:

```html
  <div id="view-home">
    <div class="home-eyebrow">Mental Armory</div>
    <h1 class="dash-title">Hype Audio</h1>
    <div class="tiles" id="tiles"></div>
    <div class="moment-row" id="moment-row"></div>
  </div>
```

- [ ] **Step 2: Render the three buttons in `renderHome()`**

At the end of `renderHome()` (after the `PILLAR_ORDER.forEach(...)` block closes), add:

```js
      const MOMENTS = [
        { key: 'pre_workout', label: 'Pre' },
        { key: 'mid_set', label: 'Mid-Set' },
        { key: 'post_workout', label: 'Post' },
      ];
      const momentRow = document.getElementById('moment-row');
      momentRow.innerHTML = '';
      MOMENTS.forEach(function (m) {
        const active = HypeAudio.isPlayingMoment(m.key);
        const btn = document.createElement('button');
        btn.className = 'moment-btn' + (active ? ' active' : '');
        btn.type = 'button';
        btn.textContent = active ? '■ STOP' : m.label;
        btn.onclick = function () {
          if (HypeAudio.isPlayingMoment(m.key)) { HypeAudio.stopPlayback(); renderHome(); return; }
          const clip = HypeAudio.playRandomLoop({ moment: m.key });
          if (!clip) { alert('No ' + m.label.toLowerCase() + ' clips yet.'); return; }
          renderHome();
        };
        momentRow.appendChild(btn);
      });
```

So `renderHome()` reads (only the new tail shown, everything above `function renderHome() {` through the existing `PILLAR_ORDER.forEach(...)` block is unchanged):

```js
    function renderHome() {
      const tiles = document.getElementById('tiles');
      tiles.innerHTML = '';
      PILLAR_ORDER.forEach(function (key) {
        // ...unchanged existing tile-rendering code...
      });

      const MOMENTS = [
        { key: 'pre_workout', label: 'Pre' },
        { key: 'mid_set', label: 'Mid-Set' },
        { key: 'post_workout', label: 'Post' },
      ];
      const momentRow = document.getElementById('moment-row');
      momentRow.innerHTML = '';
      MOMENTS.forEach(function (m) {
        const active = HypeAudio.isPlayingMoment(m.key);
        const btn = document.createElement('button');
        btn.className = 'moment-btn' + (active ? ' active' : '');
        btn.type = 'button';
        btn.textContent = active ? '■ STOP' : m.label;
        btn.onclick = function () {
          if (HypeAudio.isPlayingMoment(m.key)) { HypeAudio.stopPlayback(); renderHome(); return; }
          const clip = HypeAudio.playRandomLoop({ moment: m.key });
          if (!clip) { alert('No ' + m.label.toLowerCase() + ' clips yet.'); return; }
          renderHome();
        };
        momentRow.appendChild(btn);
      });
    }
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Render PRE/MID-SET/POST moment buttons on the home screen"
```

---

### Task 4: Keep the buttons in sync via `onPlaybackChange`

**Files:**
- Modify: `index.html:599` (the `HypeAudio.onPlaybackChange` subscription)

Currently this callback only re-renders when a pillar or mentality screen is showing -- nothing happens when the home screen is visible, because nothing on the home screen used to depend on playback state. Now it does.

- [ ] **Step 1: Add the home-screen branch**

Change:

```js
    HypeAudio.onPlaybackChange(function () {
      if (currentMentality) renderSection(currentPillar, currentMentality);
      else if (currentPillar) renderSubcats(currentPillar);
    });
```

to:

```js
    HypeAudio.onPlaybackChange(function () {
      if (currentMentality) renderSection(currentPillar, currentMentality);
      else if (currentPillar) renderSubcats(currentPillar);
      else renderHome();
    });
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "Re-render home screen on playback change so moment buttons stay in sync"
```

---

### Task 5: Sync `hype-audio.js` to the `row` repo

**Files:**
- Modify: `C:\Users\gregm\row\hype-audio.js` (copy from this repo)

Same established convention as every prior `hype-audio.js` change -- kept byte-identical between the two repos, even though `row`'s `gym.html` mini-player doesn't use `isPlayingMoment` (no per-clip/per-moment UI there).

- [ ] **Step 1: Copy the file**

```bash
cp /c/Users/gregm/hype-audio-app/hype-audio.js /c/Users/gregm/row/hype-audio.js
```

- [ ] **Step 2: Verify byte-identical**

Run: `diff /c/Users/gregm/hype-audio-app/hype-audio.js /c/Users/gregm/row/hype-audio.js && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 3: Commit in the `row` repo**

```bash
cd /c/Users/gregm/row
git add hype-audio.js
git commit -m "Sync hype-audio.js: isPlayingMoment for home-screen moment buttons"
```

---

### Task 6: Push and live-verify

**Files:** none (verification only)

- [ ] **Step 1: Push both repos**

```bash
cd /c/Users/gregm/hype-audio-app && git push origin master
cd /c/Users/gregm/row && git push origin main
```

- [ ] **Step 2: Confirm no console errors on the live site**

Browser pane: navigate to `https://hype-audio-app.vercel.app`, `read_console_messages` with `onlyErrors: true`. Expected: no errors.

- [ ] **Step 3: Confirm the three buttons render and toggle correctly**

Via `read_page` (interactive filter) on the live home screen -- expect three buttons alongside the pillar tiles. Click one (`computer` tool), then re-check via `javascript_tool`:

```js
JSON.stringify(Array.from(document.querySelectorAll('.moment-btn')).map(function (b) { return { text: b.textContent, active: b.className.indexOf('active') !== -1 }; }));
```

Expected: the clicked button shows `■ STOP` / `active: true`, the other two show their plain label / `active: false`. Click it again, expect all three back to their plain labels with `active: false`.

- [ ] **Step 4: Confirm mutual exclusion with a pillar's own PLAY RANDOM**

Start a moment loop from home, navigate into any pillar's subcat screen, confirm its own `PLAY RANDOM` button does NOT show as active (since a moment loop, not that pillar's random loop, is what's actually playing) -- if it does, that's a `isPlayingMoment`/`isPlayingRandom` conflation bug, not expected per the spec's distinct-state design.

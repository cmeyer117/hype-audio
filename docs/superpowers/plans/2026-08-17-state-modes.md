# State Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `STATE_MODES` mood mapping to the shared `hype-audio.js`, wire Row's already-existing `'grind'`/`'miss'` set classifications to the right mood, and add 4 home-screen buttons to hype-audio-app for manual mood selection.

**Architecture:** `pickRandom` gains a `stateMode` filter branch that builds its pool from `STATE_MODES[key].pairs` (an OR across exact pillar+mentality pairs) instead of the existing AND-based pillar/mentality/moment filter. Because `randomFilter`/`advance`/`stopPlayback` already handle any filter object generically, the home-screen loop buttons need no new playback-state machinery — only `isPlayingRandomFilter` gains one more field. A new single-shot `playStateMode(modeKey)` (mirroring the existing `playPrRant()`) is what Row calls.

**Tech Stack:** Plain JS (no build step), Node-based selfcheck harness (`hype-audio.selfcheck.js`, CommonJS), static HTML/CSS in `index.html`, `row/gym.html` (Row's own static app).

**Spec:** `docs/superpowers/specs/2026-08-17-state-modes-design.md`

---

### Task 1: `STATE_MODES` + `pickRandom` extension

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`
- Test: `C:\Users\gregm\hype-audio-app\hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Open `hype-audio.selfcheck.js`. Find the final line of the file:

```js
console.log('hype-audio.selfcheck.js: all assertions passed');
```

Insert the following block immediately **before** that line:

```js
// STATE_MODES / pickRandom({ stateMode }) -- pillar+mentality PAIRS, not
// bare mentality strings, so a clip matching the mentality but the wrong
// pillar is correctly excluded.
HypeAudio.addClip({ id: 'mode1', title: 'Mode Test A', pillar: 'mindset', mentality: 'discipline', play_count: 0 });
HypeAudio.addClip({ id: 'mode2', title: 'Mode Test B', pillar: 'mindset', mentality: 'resilience', play_count: 0 });
HypeAudio.addClip({ id: 'mode3', title: 'Mode Test C', pillar: 'carl', mentality: 'discipline', play_count: 0 }); // same mentality, wrong pillar -- must NOT match need_discipline
for (let i = 0; i < 15; i++) {
  const picked = HypeAudio.pickRandom({ stateMode: 'need_discipline' }).id;
  assertEqual(['mode1', 'mode2'].indexOf(picked) !== -1, true, 'pickRandom({stateMode}) only returns clips matching one of the mode\'s exact pillar+mentality pairs');
}
assertEqual(HypeAudio.pickRandom({ stateMode: 'not_a_real_mode' }), null, 'pickRandom({stateMode}) with an unknown key returns null instead of throwing');

// filterEligiblePool (cooldown exclusion, from the smarter-shuffle feature)
// applies identically on the stateMode path -- it's the same shared call,
// not a per-branch reimplementation.
HypeAudio.toggleDislikeCooldown('mode1');
for (let i = 0; i < 15; i++) {
  assertEqual(HypeAudio.pickRandom({ stateMode: 'need_discipline' }).id, 'mode2', 'pickRandom({stateMode}) excludes a cooled-down clip the same way the plain pillar/mentality path already does');
}
HypeAudio.toggleDislikeCooldown('mode1'); // clear for cleanliness
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node hype-audio.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: FAIL — `pickRandom({ stateMode: 'need_discipline' })` currently ignores `stateMode` entirely (falls through to the pillar/mentality/moment branch, all of which are `undefined` in this call), so it draws from the *entire* clip library instead of the 2-clip mode pool.

- [ ] **Step 3: Implement**

In `hype-audio.js`, find:

```js
  // Rest-timer "hype me up" button: prefers a mid_set-tagged clip; falls
```

Insert immediately **before** it (i.e., right after `pickRandom`'s closing brace, before this comment):

```js
  // Pillar+mentality PAIRS, not bare mentality strings -- mentality names
  // aren't guaranteed unique across pillars (e.g. carl/faith could collide
  // with a hypothetical future faith-pillar mentality), so pairs avoid any
  // cross-pillar collision. See docs/superpowers/specs/2026-08-17-state-modes-design.md.
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

Then find `pickRandom` itself:

```js
  function pickRandom(filter) {
    filter = filter || {};
    const pillars = Array.isArray(filter.pillar) ? filter.pillar : (filter.pillar ? [filter.pillar] : null);
    const pool = listActiveClips().filter((c) =>
      (!filter.mentality || c.mentality === filter.mentality) &&
      (!filter.moment || c.moment === filter.moment) &&
      (!pillars || pillars.indexOf(c.pillar) !== -1)
    );
    if (pool.length === 0) return null;
    const eligible = filterEligiblePool(pool);
    return eligible[Math.floor(Math.random() * eligible.length)];
  }
```

Replace it with:

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(state-modes): add STATE_MODES + pickRandom({stateMode}) support"
```

---

### Task 2: `playStateMode` single-shot wrapper + `isPlayingRandomFilter` update

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`
- Test: `C:\Users\gregm\hype-audio-app\hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Insert before the final `console.log` line:

```js
// playStateMode -- single-shot wrapper Row calls (mirrors playPrRant's
// exact shape: pick once, play once, return the clip or null).
const heavyPick = HypeAudio.playStateMode('heavy_day');
assertEqual(!!heavyPick, true, 'playStateMode plays a clip when the mode has eligible clips');
assertEqual(HypeAudio.getCurrentClip().id, heavyPick.id, 'playStateMode actually starts playback of the picked clip');
HypeAudio.stopPlayback();
assertEqual(HypeAudio.playStateMode('not_a_real_mode'), null, 'playStateMode on an unknown key returns null and plays nothing');
assertEqual(HypeAudio.getCurrentClip(), null, 'playStateMode on an unknown key does not disturb playback state');

// isPlayingRandomFilter distinguishes one state-mode loop from another
// (and from a plain pillar/mentality or moment loop), same exact-match
// pattern already covers for those.
HypeAudio.playRandomLoop({ stateMode: 'need_discipline' });
assertEqual(HypeAudio.isPlayingRandomFilter({ stateMode: 'need_discipline' }), true, 'isPlayingRandomFilter is true for the exact active state-mode loop');
assertEqual(HypeAudio.isPlayingRandomFilter({ stateMode: 'heavy_day' }), false, 'isPlayingRandomFilter is false for a different state mode');
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'mindset' }), false, 'isPlayingRandomFilter is false for a plain pillar filter while a state-mode loop is active');
HypeAudio.stopPlayback();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node hype-audio.selfcheck.js`
Expected: `TypeError: HypeAudio.playStateMode is not a function`

- [ ] **Step 3: Implement**

In `hype-audio.js`, find:

```js
  function playPrRant() {
    const clip = pickRandom({ pillar: 'carl' });
    if (clip) playClip(clip);
    return clip;
  }
```

Add immediately after it:

```js

  // Single-shot: pick one clip from `modeKey`'s pool and play it -- the
  // shape Row's rest-timer wants (one clip per logged set), not an
  // endless loop. Mirrors playPrRant/playMidSetHype exactly.
  function playStateMode(modeKey) {
    const clip = pickRandom({ stateMode: modeKey });
    if (clip) playClip(clip);
    return clip;
  }
```

Then find `isPlayingRandomFilter`:

```js
  function isPlayingRandomFilter(filter) {
    if (!randomFilter) return false;
    filter = filter || {};
    return randomFilter.pillar === filter.pillar && randomFilter.mentality === filter.mentality && randomFilter.moment === filter.moment;
  }
```

Replace it with:

```js
  function isPlayingRandomFilter(filter) {
    if (!randomFilter) return false;
    filter = filter || {};
    return randomFilter.pillar === filter.pillar && randomFilter.mentality === filter.mentality &&
      randomFilter.moment === filter.moment && randomFilter.stateMode === filter.stateMode;
  }
```

Finally, add `playStateMode` to both export blocks. Find `window.HypeAudio = {` and, after the `playPrRant: playPrRant,` line inside it, add `playStateMode: playStateMode,`. Do the same for the `module.exports = {` block's own `playPrRant: playPrRant,` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node hype-audio.selfcheck.js && node sync.selfcheck.js && node sw.selfcheck.js`
Expected: all three print `all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(state-modes): add playStateMode single-shot wrapper for Row"
```

---

### Task 3: Wire Row's `'grind'`/`'miss'` to the right mood

**Files:**
- Modify: `C:\Users\gregm\row\gym.html`

Row has no test framework for `gym.html` (same precedent as every other Row UI change this session) — this task ends with live browser verification.

- [ ] **Step 1: Sync the updated `hype-audio.js` to Row first**

Row needs `playStateMode`/`STATE_MODES` to exist before `gym.html` can call it:

```bash
cp "C:/Users/gregm/hype-audio-app/hype-audio.js" "C:/Users/gregm/row/hype-audio.js"
cd C:\Users\gregm\row
node hype-audio.selfcheck.cjs
```

Expected: `hype-audio.selfcheck.cjs: all assertions passed`

- [ ] **Step 2: Wire the two new branches**

In `row\gym.html`, find:

```js
    if (window.HypeAudio && window.HypeAudio.AUTO_PLAY_HYPE) {
      // A PR plays its own rant, not the general hype clip too -- playClip()
      // stops whatever's already playing, so calling both back to back would
      // silently kill the hype clip a fraction of a second in and still
      // increment its play_count for a clip nobody actually heard.
      if (restTimerEventType === 'pr') window.HypeAudio.playPrRant();
      else window.HypeAudio.playMidSetHype();
    }
```

Replace it with:

```js
    if (window.HypeAudio && window.HypeAudio.AUTO_PLAY_HYPE) {
      // A PR plays its own rant, not the general hype clip too -- playClip()
      // stops whatever's already playing, so calling both back to back would
      // silently kill the hype clip a fraction of a second in and still
      // increment its play_count for a clip nobody actually heard.
      if (restTimerEventType === 'pr') window.HypeAudio.playPrRant();
      else if (restTimerEventType === 'grind') window.HypeAudio.playStateMode('need_discipline');
      else if (restTimerEventType === 'miss') window.HypeAudio.playStateMode('post_failure_reset');
      else window.HypeAudio.playMidSetHype();
    }
```

- [ ] **Step 3: Verify live in browser**

Using the Claude_Browser MCP tools (`.claude/launch.json` has a `row` config, port 5555):

1. `preview_start` with `{name: "row"}`, navigate to `gym.html`.
2. Pick any logged exercise with existing history (needed for `classifyWorkoutEvent` to have `priorLogs` to compare against — a brand-new exercise with zero prior logs always returns `null`).
3. Via `javascript_tool`, call `window.GymWorkoutEvents.classifyWorkoutEvent({weight: <below the exercise's repMin-worth>, reps: <under repMin>}, <that exercise's real priorLogs from state.logs>, <that exercise object>)` to confirm what inputs actually produce `'grind'` and `'miss'` for a real exercise in the current state, rather than guessing at numbers blind.
4. Log a set that produces `'grind'` (reps exactly equal to `ex.repMin`) — confirm via `javascript_tool` that `window.HypeAudio.getCurrentClip().pillar`/`.mentality` matches one of `need_discipline`'s pairs (`mindset/discipline` or `mindset/resilience`).
5. Log a set that produces `'miss'` (reps under `ex.repMin`) — confirm the current clip matches one of `post_failure_reset`'s pairs.
6. Log a normal set (`null` event) — confirm the existing generic mid-set behavior is unchanged (any clip plays, no restriction to the new mode pools).
7. `read_console_messages` with `onlyErrors: true` — confirm no new errors.

- [ ] **Step 4: Commit and push**

```bash
cd C:\Users\gregm\row
git add hype-audio.js gym.html
git commit -m "feat(state-modes): route grind/miss sets to the matching hype-audio mood"
git push origin main
```

---

### Task 4: 4 home-screen buttons in `index.html`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\index.html`

No test framework covers UI here (same precedent as moment-modes) — live browser verification instead.

- [ ] **Step 1: Add the markup**

Find:

```html
    <div class="moment-row" id="moment-row"></div>
```

Add immediately after it:

```html
    <div class="moment-row" id="state-mode-row"></div>
```

(Reuses the `.moment-row`/`.moment-btn` CSS classes as-is — same visual treatment, no new styles needed.)

- [ ] **Step 2: Add the render logic**

Find:

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
    }
```

Replace it with:

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

      const STATE_MODES_UI = [
        { key: 'heavy_day', label: 'Heavy Day' },
        { key: 'need_discipline', label: 'Need Discipline' },
        { key: 'post_failure_reset', label: 'Post-Failure Reset' },
        { key: 'locked_in', label: 'Locked In' },
      ];
      const stateModeRow = document.getElementById('state-mode-row');
      stateModeRow.innerHTML = '';
      STATE_MODES_UI.forEach(function (m) {
        const active = HypeAudio.isPlayingRandomFilter({ stateMode: m.key });
        const btn = document.createElement('button');
        btn.className = 'moment-btn' + (active ? ' active' : '');
        btn.type = 'button';
        btn.textContent = active ? '■ STOP' : m.label;
        btn.onclick = function () {
          if (HypeAudio.isPlayingRandomFilter({ stateMode: m.key })) { HypeAudio.stopPlayback(); renderHome(); return; }
          const clip = HypeAudio.playRandomLoop({ stateMode: m.key });
          if (!clip) { alert('No ' + m.label.toLowerCase() + ' clips yet.'); return; }
          renderHome();
        };
        stateModeRow.appendChild(btn);
      });
    }
```

- [ ] **Step 3: Run the full selfcheck suite as a regression check**

Run: `node hype-audio.selfcheck.js && node sync.selfcheck.js && node sw.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: all three print `all assertions passed`

- [ ] **Step 4: Verify live in browser**

1. `preview_start` with `{name: "hype-audio"}` (or navigate an existing tab).
2. On the home screen, confirm a new row of 4 buttons appears below PRE/MID-SET/POST, labeled Heavy Day / Need Discipline / Post-Failure Reset / Locked In.
3. Tap Heavy Day — confirm it starts playing and the button flips to `■ STOP`; via `javascript_tool`, call `HypeAudio.getCurrentClip()` and confirm its `pillar`/`mentality` matches one of `heavy_day`'s 4 pairs.
4. Tap `■ STOP` — confirm playback stops and the button reverts to its label.
5. Tap Need Discipline, then (without stopping) tap Locked In — confirm the loop switches cleanly (matches the existing moment-button switching behavior, no extra code needed since `playRandomLoop` already cancels whatever was playing).
6. `read_console_messages` with `onlyErrors: true` — confirm no new errors.

- [ ] **Step 5: Commit and push**

```bash
cd C:\Users\gregm\hype-audio-app
git add index.html
git commit -m "feat(state-modes): add 4 home-screen state-mode buttons"
git push origin master
```

- [ ] **Step 6: Confirm the Vercel deploy is READY**

Using the Vercel MCP tools: `list_deployments` for project `prj_Yfz9Uz8yxIjIJYtwC1RVEHoshQqE`, team `team_YFOSyD1ZMto3FYzNINBi7fcm` — confirm the newest deployment's `githubCommitSha` matches the latest local commit and `state` is `READY`.

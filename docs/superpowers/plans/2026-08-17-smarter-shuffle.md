# Smarter Shuffle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit 1-day "Not now" cooldown and a 5-clip no-repeat window to the shared random/favorites pickers in `hype-audio.js`, reachable from every screen that uses them (hype-audio-app's own UI and Row's mini-player).

**Architecture:** A single `filterEligiblePool(pool)` helper narrows an already-filtered clip pool by cooldown and recency (each with a safety fallback to a wider pool so a pick is never blocked), called from both `pickRandom` and `pickFavoriteWeighted` right before they select. A new `disliked_until` field on the clip object (synced like every other field) drives cooldown; an in-memory `recentlyPlayed` array (never synced) drives no-repeat.

**Tech Stack:** Plain JS (no build step), Node-based selfcheck harness (`hype-audio.selfcheck.js`, CommonJS via `module.exports`), static HTML/CSS in `index.html`.

**Spec:** `docs/superpowers/specs/2026-08-17-smarter-shuffle-design.md`

---

### Task 1: `toggleDislikeCooldown` / `isOnCooldown`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`
- Test: `C:\Users\gregm\hype-audio-app\hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Open `hype-audio.selfcheck.js`. Find the final line of the file:

```js
console.log('hype-audio.selfcheck.js: all assertions passed');
```

Insert the following block immediately **before** that line (the `console.log` call stays last):

```js
// toggleDislikeCooldown / isOnCooldown -- an explicit "Not now" action that
// excludes a clip from random/favorites picks for 1 day, then it's
// automatically back in rotation.
HypeAudio.addClip({ id: 'shuffle1', title: 'Shuffle Test A', mentality: 'test', pillar: 'iron', play_count: 0 });
assertEqual(HypeAudio.isOnCooldown(HypeAudio.listClips().find(c => c.id === 'shuffle1')), false, 'a fresh clip is not on cooldown');
HypeAudio.toggleDislikeCooldown('shuffle1');
const cooledClip = HypeAudio.listClips().find(c => c.id === 'shuffle1');
assertEqual(HypeAudio.isOnCooldown(cooledClip), true, 'toggleDislikeCooldown puts the clip on cooldown');
assertEqual(cooledClip.disliked_until > Date.now(), true, 'disliked_until is set in the future');
assertEqual(cooledClip.disliked_until <= Date.now() + 24 * 60 * 60 * 1000, true, 'disliked_until is at most 1 day out');
HypeAudio.toggleDislikeCooldown('shuffle1');
assertEqual(HypeAudio.isOnCooldown(HypeAudio.listClips().find(c => c.id === 'shuffle1')), false, 'toggling again while on cooldown clears it');
HypeAudio.toggleDislikeCooldown('nonexistent-id'); // must not throw
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node hype-audio.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: `TypeError: HypeAudio.isOnCooldown is not a function`

- [ ] **Step 3: Implement**

In `hype-audio.js`, find:

```js
  let queue = null;
  let randomFilter = null;
  let repeatClip = null;
```

Add immediately after that block:

```js
  // 1-day cooldown, set explicitly via toggleDislikeCooldown -- see
  // docs/superpowers/specs/2026-08-17-smarter-shuffle-design.md.
  const DISLIKE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  function isOnCooldown(clip) {
    return !!(clip && clip.disliked_until && clip.disliked_until > Date.now());
  }

  function toggleDislikeCooldown(clipId) {
    const clip = listClips().find(function (c) { return c.id === clipId; });
    if (!clip) return;
    updateClip(clipId, { disliked_until: isOnCooldown(clip) ? null : Date.now() + DISLIKE_COOLDOWN_MS });
  }
```

Then find the `window.HypeAudio = {` export block and, immediately after the `migrateCarlToOwnPillar: migrateCarlToOwnPillar,` line inside it, add:

```js
      isOnCooldown: isOnCooldown,
      toggleDislikeCooldown: toggleDislikeCooldown,
```

Then find the `module.exports = {` block (the second, Node-only export block) and add the same two lines after its own `migrateCarlToOwnPillar: migrateCarlToOwnPillar,` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(shuffle): add toggleDislikeCooldown / isOnCooldown"
```

---

### Task 2: `filterEligiblePool` + recency tracking, wired into `pickRandom`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`
- Test: `C:\Users\gregm\hype-audio-app\hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Insert before the final `console.log` line:

```js
// filterEligiblePool (via pickRandom) -- cooldown exclusion, with a
// fallback so an all-cooled-down pool still returns a pick.
HypeAudio.addClip({ id: 'shuffle2', title: 'Shuffle Test B', mentality: 'shuffletest', pillar: 'iron', play_count: 0 });
HypeAudio.addClip({ id: 'shuffle3', title: 'Shuffle Test C', mentality: 'shuffletest', pillar: 'iron', play_count: 0 });
HypeAudio.toggleDislikeCooldown('shuffle2');
for (let i = 0; i < 10; i++) {
  assertEqual(HypeAudio.pickRandom({ mentality: 'shuffletest' }).id, 'shuffle3', 'pickRandom excludes a clip on cooldown when an eligible one exists');
}
HypeAudio.toggleDislikeCooldown('shuffle3'); // now both shuffle2 and shuffle3 are on cooldown
const bothCooledPick = HypeAudio.pickRandom({ mentality: 'shuffletest' });
assertEqual(['shuffle2', 'shuffle3'].indexOf(bothCooledPick.id) !== -1, true, 'pickRandom still returns a pick when the whole pool is on cooldown (fallback engages)');
HypeAudio.toggleDislikeCooldown('shuffle2'); // clear both for the recency test below
HypeAudio.toggleDislikeCooldown('shuffle3');

// No-repeat window -- a clip just played is excluded from the next pick as
// long as an alternative exists in the same pool. The Node Audio shim
// doesn't auto-fire 'play' (see the shim near the top of this file), so
// onplay must be invoked manually -- same pattern the play_count tests
// above already use (e.g. `countAudio.onplay()`). recentlyPlayed is
// populated inside onplay, not by playClip() itself.
const shuffle2Audio = HypeAudio.playClip(HypeAudio.listClips().find(c => c.id === 'shuffle2'));
shuffle2Audio.onplay();
for (let i = 0; i < 10; i++) {
  assertEqual(HypeAudio.pickRandom({ mentality: 'shuffletest' }).id, 'shuffle3', 'pickRandom avoids repicking the clip that just played when an alternative exists');
}
HypeAudio.stopPlayback();

// Recency fallback -- a pool of exactly one clip still returns that clip
// even after it was "just played" (recency filter would otherwise empty it).
HypeAudio.addClip({ id: 'shuffle4', title: 'Shuffle Test D', mentality: 'shuffleonly', pillar: 'iron', play_count: 0 });
const shuffle4Audio = HypeAudio.playClip(HypeAudio.listClips().find(c => c.id === 'shuffle4'));
shuffle4Audio.onplay();
assertEqual(HypeAudio.pickRandom({ mentality: 'shuffleonly' }).id, 'shuffle4', 'pickRandom falls back to the just-played clip when it is the only one in the pool');
HypeAudio.stopPlayback();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node hype-audio.selfcheck.js`
Expected: FAIL — the "excludes a clip on cooldown" assertion fails because `pickRandom` doesn't apply any cooldown/recency filtering yet (it may return `shuffle2` even though it's on cooldown).

- [ ] **Step 3: Implement**

In `hype-audio.js`, find the `let queue = null;` block again (now followed by the `DISLIKE_COOLDOWN_MS`/`isOnCooldown`/`toggleDislikeCooldown` block added in Task 1) and add after `toggleDislikeCooldown`'s closing brace:

```js
  // Ephemeral, never synced -- mirrors queue/randomFilter's module-level
  // state. Resets on page load; repeat-avoidance is a live-session nicety.
  let recentlyPlayed = [];
  const RECENT_WINDOW = 5;

  // Narrows `pool` by cooldown + recency, each with a fallback to
  // guarantee a non-empty result whenever `pool` itself is non-empty -- so
  // a 2-clip mentality where both are cooling down still plays something,
  // and a pool of exactly the 5 most-recent clips still plays something.
  function filterEligiblePool(pool) {
    const notOnCooldown = pool.filter(function (c) { return !isOnCooldown(c); });
    const base = notOnCooldown.length ? notOnCooldown : pool;
    const notRecent = base.filter(function (c) { return recentlyPlayed.indexOf(c.id) === -1; });
    return notRecent.length ? notRecent : base;
  }
```

Then find `pickRandom`:

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
    return pool[Math.floor(Math.random() * pool.length)];
  }
```

Replace it with:

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

Finally, wire recency tracking into `playSingle`'s `onplay` handler. Find:

```js
      if (!counted) {
        counted = true;
        // Fresh read, not clip.play_count -- `clip` can be a stale snapshot
        // (repeat mode reuses one object forever, so counts never accumulated).
        const fresh = listClips().find(function (c) { return c.id === clip.id; });
        updateClip(clip.id, { play_count: ((fresh && fresh.play_count) || 0) + 1 });
      }
```

Replace it with:

```js
      if (!counted) {
        counted = true;
        // Fresh read, not clip.play_count -- `clip` can be a stale snapshot
        // (repeat mode reuses one object forever, so counts never accumulated).
        const fresh = listClips().find(function (c) { return c.id === clip.id; });
        updateClip(clip.id, { play_count: ((fresh && fresh.play_count) || 0) + 1 });
        recentlyPlayed.push(clip.id);
        if (recentlyPlayed.length > RECENT_WINDOW) recentlyPlayed.shift();
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(shuffle): filterEligiblePool + recency tracking, wired into pickRandom"
```

---

### Task 3: Wire `filterEligiblePool` into `pickFavoriteWeighted`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\hype-audio.js`
- Test: `C:\Users\gregm\hype-audio-app\hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing test**

Insert before the final `console.log` line:

```js
// filterEligiblePool applies to pickFavoriteWeighted too -- Task 2 only
// covered pickRandom.
HypeAudio.addClip({ id: 'shuffle5', title: 'Shuffle Test E', mentality: 'favshuffletest', pillar: 'iron', favorite: true, play_count: 0 });
HypeAudio.addClip({ id: 'shuffle6', title: 'Shuffle Test F', mentality: 'favshuffletest', pillar: 'iron', favorite: true, play_count: 0 });
HypeAudio.toggleDislikeCooldown('shuffle5');
for (let i = 0; i < 10; i++) {
  assertEqual(HypeAudio.pickFavoriteWeighted({ mentality: 'favshuffletest' }).id, 'shuffle6', 'pickFavoriteWeighted excludes a clip on cooldown when an eligible one exists');
}
HypeAudio.toggleDislikeCooldown('shuffle5'); // clear for cleanliness
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node hype-audio.selfcheck.js`
Expected: FAIL — `pickFavoriteWeighted` still weights `shuffle5` into its pick pool even while on cooldown.

- [ ] **Step 3: Implement**

In `hype-audio.js`, find `pickFavoriteWeighted`:

```js
  function pickFavoriteWeighted(filter) {
    filter = filter || {};
    const pillars = Array.isArray(filter.pillar) ? filter.pillar : (filter.pillar ? [filter.pillar] : null);
    const pool = listActiveClips().filter((c) =>
      (!filter.mentality || c.mentality === filter.mentality) &&
      (!filter.moment || c.moment === filter.moment) &&
      (!pillars || pillars.indexOf(c.pillar) !== -1)
    );
    if (pool.length === 0) return null;
    const weighted = [];
    pool.forEach(function (c) {
      const weight = c.favorite ? 4 : 1;
      for (let i = 0; i < weight; i++) weighted.push(c);
    });
    return weighted[Math.floor(Math.random() * weighted.length)];
  }
```

Replace it with:

```js
  function pickFavoriteWeighted(filter) {
    filter = filter || {};
    const pillars = Array.isArray(filter.pillar) ? filter.pillar : (filter.pillar ? [filter.pillar] : null);
    const pool = listActiveClips().filter((c) =>
      (!filter.mentality || c.mentality === filter.mentality) &&
      (!filter.moment || c.moment === filter.moment) &&
      (!pillars || pillars.indexOf(c.pillar) !== -1)
    );
    if (pool.length === 0) return null;
    const eligible = filterEligiblePool(pool);
    const weighted = [];
    eligible.forEach(function (c) {
      const weight = c.favorite ? 4 : 1;
      for (let i = 0; i < weight; i++) weighted.push(c);
    });
    return weighted[Math.floor(Math.random() * weighted.length)];
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(shuffle): wire filterEligiblePool into pickFavoriteWeighted"
```

---

### Task 4: "Not now" menu item in `index.html`

**Files:**
- Modify: `C:\Users\gregm\hype-audio-app\index.html`

No automated test framework covers UI in this static app (see the 2026-07-26 moment-modes spec for precedent) — this task ends with a live browser verification step instead of a selfcheck run.

- [ ] **Step 1: Add a neutral menu-item color variant**

In `index.html`, find:

```css
  .menu-item {
    width: 100%; padding: 10px 14px; background: transparent; border: 0; text-align: left;
    color: var(--danger); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .menu-item:hover { background: rgba(255,138,138,0.1); }
```

Replace it with:

```css
  .menu-item {
    width: 100%; padding: 10px 14px; background: transparent; border: 0; text-align: left;
    color: var(--danger); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .menu-item:hover { background: rgba(255,138,138,0.1); }
  .menu-item.menu-item-neutral { color: var(--text-primary); }
  .menu-item.menu-item-neutral:hover { background: rgba(255,255,255,0.06); }
```

- [ ] **Step 2: Add the "Not now" item**

Find:

```js
        const dropdown = document.createElement('div');
        dropdown.className = 'menu-dropdown';
        const delItem = document.createElement('button');
        delItem.className = 'menu-item';
        delItem.textContent = 'Delete';
        delItem.onclick = function () {
          dropdown.classList.remove('open');
          if (!confirm('Delete "' + clip.title + '"? This can\'t be undone.')) return;
          HypeAudio.deleteClip(clip.id);
          renderSection(key, mentality);
        };
        dropdown.appendChild(delItem);
```

Replace it with:

```js
        const dropdown = document.createElement('div');
        dropdown.className = 'menu-dropdown';
        const cooldownItem = document.createElement('button');
        cooldownItem.className = 'menu-item menu-item-neutral';
        cooldownItem.textContent = HypeAudio.isOnCooldown(clip) ? 'Cancel cooldown' : 'Not now (1 day)';
        cooldownItem.onclick = function () {
          dropdown.classList.remove('open');
          HypeAudio.toggleDislikeCooldown(clip.id);
          renderSection(key, mentality);
        };
        const delItem = document.createElement('button');
        delItem.className = 'menu-item';
        delItem.textContent = 'Delete';
        delItem.onclick = function () {
          dropdown.classList.remove('open');
          if (!confirm('Delete "' + clip.title + '"? This can\'t be undone.')) return;
          HypeAudio.deleteClip(clip.id);
          renderSection(key, mentality);
        };
        dropdown.appendChild(cooldownItem);
        dropdown.appendChild(delItem);
```

- [ ] **Step 3: Run the full selfcheck suite as a regression check**

Run: `node hype-audio.selfcheck.js && node sync.selfcheck.js && node sw.selfcheck.js` from `C:\Users\gregm\hype-audio-app`
Expected: all three print `all assertions passed`

- [ ] **Step 4: Verify live in browser**

Using the Claude_Browser MCP tools (preview already configured as `hype-audio` in `.claude/launch.json`, port 5557):

1. `preview_start` with `{name: "hype-audio"}` (or navigate an existing tab to `http://localhost:5557` if already running).
2. Open any pillar → mentality → clip list.
3. Tap a clip row's `⋮` menu — confirm "Not now (1 day)" appears above "Delete".
4. Tap it — confirm the dropdown closes and the row re-renders with no visible error; open the `⋮` menu again and confirm the label now reads "Cancel cooldown".
5. Tap "Cancel cooldown" — confirm it flips back to "Not now (1 day)".
6. Via `javascript_tool`, run `HypeAudio.listActiveClips()[0]` before/after step 4 to confirm `disliked_until` is actually being set/cleared on the underlying clip object.
7. `read_console_messages` with `onlyErrors: true` — confirm no new errors.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add index.html
git commit -m "feat(shuffle): add Not now (1 day) cooldown action to the clip row menu"
```

---

### Task 5: Sync to Row + push both repos

**Files:**
- Modify: `C:\Users\gregm\row\hype-audio.js` (copy of the canonical file)

- [ ] **Step 1: Copy the updated file**

```bash
cp "C:/Users/gregm/hype-audio-app/hype-audio.js" "C:/Users/gregm/row/hype-audio.js"
```

- [ ] **Step 2: Run Row's own selfcheck**

Run: `node hype-audio.selfcheck.cjs` from `C:\Users\gregm\row`
Expected: `hype-audio.selfcheck.cjs: all assertions passed`

If Row's selfcheck doesn't already cover the new functions, that's fine — it exercises `playMidSetHype`/`playPrRant` end-to-end, which now transitively go through `pickRandom` → `filterEligiblePool`. A pass here confirms the synced file doesn't break Row's existing call paths, not full coverage of the new feature (that's `hype-audio-app`'s own selfcheck, already run in Tasks 1-3).

- [ ] **Step 3: Confirm the copy is byte-identical**

```bash
diff "C:/Users/gregm/row/hype-audio.js" "C:/Users/gregm/hype-audio-app/hype-audio.js" && echo IDENTICAL
```

Expected: `IDENTICAL`

- [ ] **Step 4: Commit and push Row**

```bash
cd C:\Users\gregm\row
git add hype-audio.js
git commit -m "sync(hype-audio): pull smarter-shuffle (cooldown + no-repeat) from the canonical repo"
git push origin main
```

- [ ] **Step 5: Push hype-audio-app**

```bash
cd C:\Users\gregm\hype-audio-app
git push origin master
```

- [ ] **Step 6: Confirm the Vercel deploy is READY**

Using the Vercel MCP tools: `list_deployments` for project `prj_Yfz9Uz8yxIjIJYtwC1RVEHoshQqE`, team `team_YFOSyD1ZMto3FYzNINBi7fcm` — confirm the newest deployment's `githubCommitSha` matches the latest local commit and `state` is `READY`. If `BUILDING`, poll `get_deployment` on that deployment id until it resolves.

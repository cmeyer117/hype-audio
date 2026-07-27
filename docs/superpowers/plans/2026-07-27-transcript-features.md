# Transcript Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build search, static quote previews, a favorite toggle + favorites-weighted shuffle mode, and a bulk title-review screen on top of the transcript data the companion migration attaches to clips.

**Architecture:** Shared logic (`searchClips`, `quotePreview`, `pickFavoriteWeighted`, the new `favoritesFilter` playback mode) goes into `hype-audio.js`, synced byte-identical into `row` per this repo's established convention. UI (search box, quote-preview lines, favorite star, favorites-shuffle button, title-review view) goes into `index.html`.

**Tech Stack:** Plain JS, no build step. `hype-audio.selfcheck.js` (this repo's copy, which already has a working `Audio`/`localStorage` shim and runs fine via plain `require()` — no `package.json` here, so no ESM/CJS issue like Row's copy has).

Specs: `docs/superpowers/specs/2026-07-27-transcript-features-design.md` (this repo), `G:\My Drive\Claude\docs\superpowers\specs\2026-07-27-transcript-migration-design.md` (companion, describes the data this all reads).

---

### Task 1: `searchClips` + `quotePreview` in hype-audio.js, with tests

**Files:**
- Modify: `hype-audio.js` (new functions, near `pickRandom`)
- Modify: `hype-audio.js` (both export blocks)
- Test: `hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Add to `hype-audio.selfcheck.js`, before its final `console.log`:

```js
// searchClips -- case-insensitive substring across title + transcript_text
HypeAudio.addClip({ id: 'search1', title: 'Discipline Equals Freedom', mentality: 'goggins', play_count: 0 });
HypeAudio.addClip({ id: 'search2', title: 'Untitled', mentality: 'dorian', transcript_text: 'Stay hard no matter what happens', play_count: 0 });
assertEqual(HypeAudio.searchClips('freedom').map(c => c.id), ['search1'], 'searchClips matches on title, case-insensitive');
assertEqual(HypeAudio.searchClips('STAY HARD').map(c => c.id), ['search2'], 'searchClips matches on transcript_text, case-insensitive');
assertEqual(HypeAudio.searchClips('nonexistent phrase'), [], 'searchClips returns [] when nothing matches');
assertEqual(HypeAudio.searchClips(''), [], 'searchClips returns [] for an empty query');
HypeAudio.addClip({ id: 'search3', title: null, mentality: 'dorian', transcript_text: 123, play_count: 0 });
assertEqual(HypeAudio.searchClips('anything').indexOf('search3'), -1, 'searchClips ignores clips with non-string title/transcript_text instead of throwing');

// quotePreview -- truncation + graceful absence
const longClip = { transcript_text: 'a'.repeat(100) };
assertEqual(HypeAudio.quotePreview(longClip, 10).length, 11, 'quotePreview truncates to maxLen + ellipsis char');
assertEqual(HypeAudio.quotePreview({ transcript_text: 'short' }, 80), 'short', 'quotePreview returns full text when under maxLen');
assertEqual(HypeAudio.quotePreview({}, 80), null, 'quotePreview returns null with no transcript_text');
assertEqual(HypeAudio.quotePreview({ transcript_text: 'hello world' }, 0), '…', 'quotePreview with maxLen:0 truncates immediately rather than using the 80-char default');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node hype-audio.selfcheck.js`
Expected: FAIL — `TypeError: HypeAudio.searchClips is not a function`

- [ ] **Step 3: Write the implementation**

In `hype-audio.js`, add immediately after `pickRandom` (after its closing `}`):

```js
  // Case-insensitive substring match across title + transcript_text. A
  // personal library of ~1000 clips doesn't need fuzzy-search infra --
  // this is deliberately simple.
  function searchClips(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return listActiveClips().filter(function (c) {
      return (typeof c.title === 'string' && c.title.toLowerCase().indexOf(q) !== -1) ||
             (typeof c.transcript_text === 'string' && c.transcript_text.toLowerCase().indexOf(q) !== -1);
    });
  }

  // Same first-segment-style truncation the migration uses for
  // suggested_title, applied here to transcript_text for the per-row
  // preview -- consistent presentation between the two.
  function quotePreview(clip, maxLen) {
    // typeof check, not `maxLen || 80` -- a caller explicitly passing 0
    // would otherwise silently get the 80-char default instead of an
    // empty/immediate truncation.
    if (typeof maxLen !== 'number') maxLen = 80;
    if (typeof clip.transcript_text !== 'string' || !clip.transcript_text) return null;
    const text = clip.transcript_text.trim();
    if (text.length <= maxLen) return text;
    const truncated = text.slice(0, maxLen).replace(/\s+\S*$/, '');
    return (truncated || text.slice(0, maxLen)) + '…';
  }
```

Then add `searchClips: searchClips,` and `quotePreview: quotePreview,` to both the `window.HypeAudio = { ... }` and `module.exports = { ... }` blocks, right after their existing `pickRandom: pickRandom,` lines.

- [ ] **Step 4: Run to verify it passes**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(transcript): add searchClips + quotePreview to hype-audio.js"
```

---

### Task 2: Favorites-weighted playback mode in hype-audio.js, with tests

**Files:**
- Modify: `hype-audio.js` (new `favoritesFilter` mode, `pickFavoriteWeighted`, `playFavoritesWeightedLoop`, `isPlayingFavoritesWeighted`; updates to `playClip`, `playRepeat`, `playFromList`, `playRandomLoop`, `advance`, `stopPlayback`, `mediaSessionNext`, `mediaSessionPrevious`, and their call sites)
- Modify: `hype-audio.js` (both export blocks)
- Test: `hype-audio.selfcheck.js`

- [ ] **Step 1: Write the failing tests**

Add to `hype-audio.selfcheck.js`:

```js
// pickFavoriteWeighted -- only returns clips from the correctly-filtered
// pool (weighting itself isn't asserted exactly since it's random)
HypeAudio.addClip({ id: 'fav1', title: 'A', mentality: 'goggins', pillar: 'iron', favorite: true, play_count: 0 });
HypeAudio.addClip({ id: 'fav2', title: 'B', mentality: 'goggins', pillar: 'iron', favorite: false, play_count: 0 });
HypeAudio.addClip({ id: 'fav3', title: 'C', mentality: 'dorian', pillar: 'iron', favorite: true, play_count: 0 });
for (let i = 0; i < 20; i++) {
  const picked = HypeAudio.pickFavoriteWeighted({ pillar: 'iron', mentality: 'goggins' });
  assertEqual(['fav1', 'fav2'].indexOf(picked.id) !== -1, true, 'pickFavoriteWeighted only picks from the filtered pool');
}
assertEqual(HypeAudio.pickFavoriteWeighted({ pillar: 'nonexistent' }), null, 'pickFavoriteWeighted returns null for an empty pool');

// playFavoritesWeightedLoop / isPlayingFavoritesWeighted / stopPlayback
const favClip = HypeAudio.playFavoritesWeightedLoop({ pillar: 'iron', mentality: 'goggins' });
assertEqual(['fav1', 'fav2'].indexOf(favClip.id) !== -1, true, 'playFavoritesWeightedLoop plays a clip from the filtered pool');
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'goggins' }), true, 'isPlayingFavoritesWeighted true while the loop is active');
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'dorian' }), false, 'isPlayingFavoritesWeighted false for a different filter');
HypeAudio.stopPlayback();
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'goggins' }), false, 'stopPlayback clears favoritesFilter');

// Mutual exclusion: starting any other mode must clear favoritesFilter,
// not just stopPlayback -- this is the real bug Codex's review caught.
HypeAudio.playFavoritesWeightedLoop({ pillar: 'iron', mentality: 'goggins' });
HypeAudio.playClip(HypeAudio.listActiveClips().find(c => c.id === 'fav1'));
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'goggins' }), false, 'playClip clears a previously-active favoritesFilter');

HypeAudio.playFavoritesWeightedLoop({ pillar: 'iron', mentality: 'goggins' });
HypeAudio.playRepeat(HypeAudio.listActiveClips().find(c => c.id === 'fav1'));
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'goggins' }), false, 'playRepeat clears a previously-active favoritesFilter');

HypeAudio.playFavoritesWeightedLoop({ pillar: 'iron', mentality: 'goggins' });
HypeAudio.playFromList([HypeAudio.listActiveClips().find(c => c.id === 'fav1')], 'fav1');
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'goggins' }), false, 'playFromList clears a previously-active favoritesFilter');

HypeAudio.playFavoritesWeightedLoop({ pillar: 'iron', mentality: 'goggins' });
HypeAudio.playRandomLoop({ pillar: 'iron', mentality: 'goggins' });
assertEqual(HypeAudio.isPlayingFavoritesWeighted({ pillar: 'iron', mentality: 'goggins' }), false, 'playRandomLoop clears a previously-active favoritesFilter');
HypeAudio.stopPlayback();

// mediaSessionNext/Previous favorites-mode awareness
const nextResult = HypeAudio.mediaSessionNext(null, null, null, { pillar: 'iron', mentality: 'goggins' });
assertEqual(nextResult.type, 'clip', 'mediaSessionNext picks a clip when favoritesFilterState is active');
const prevResult = HypeAudio.mediaSessionPrevious(null, null, null, 0, { pillar: 'iron', mentality: 'goggins' });
assertEqual(prevResult.type, 'none', 'mediaSessionPrevious is a no-op during a favorites loop, same as randomFilter');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node hype-audio.selfcheck.js`
Expected: FAIL — `TypeError: HypeAudio.pickFavoriteWeighted is not a function`

- [ ] **Step 3: Write the implementation**

Add `pickFavoriteWeighted`, the `favoritesFilter` variable, `playFavoritesWeightedLoop`, and `isPlayingFavoritesWeighted` right after `isPlayingRandomFilter` (find it via `grep -n "function isPlayingRandomFilter"`):

```js
  // Favorite-weighted pick: favorited clips are ~4x as likely to be
  // picked as non-favorited ones in the same filtered pool, but
  // non-favorited clips can still come up -- not an exclusive filter,
  // a weighting. Mirrors pickRandom's filter shape (pillar/mentality/moment).
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

  // Mirrors playRandomLoop/randomFilter exactly, but as its own mode so
  // the existing pure-random PLAY RANDOM is never touched by favoriting
  // clips.
  let favoritesFilter = null;

  function playFavoritesWeightedLoop(filter) {
    queue = null;
    repeatClip = null;
    randomFilter = null;
    const clip = pickFavoriteWeighted(filter);
    if (!clip) { favoritesFilter = null; return null; }
    favoritesFilter = filter || {};
    return playSingle(clip);
  }

  function isPlayingFavoritesWeighted(filter) {
    if (!favoritesFilter) return false;
    filter = filter || {};
    return favoritesFilter.pillar === filter.pillar && favoritesFilter.mentality === filter.mentality && favoritesFilter.moment === filter.moment;
  }
```

Now find and update the four existing mode-starters to also reset `favoritesFilter` (search for each function name):

```js
  function playClip(clip) {
    queue = null;
    randomFilter = null;
    repeatClip = null;
    favoritesFilter = null;
    return playSingle(clip);
  }
```
```js
  function playRepeat(clip) {
    queue = null;
    randomFilter = null;
    repeatClip = clip;
    favoritesFilter = null;
    return playSingle(clip);
  }
```
```js
  function playFromList(clips, clipId) {
    const idx = clips.findIndex(function (c) { return c.id === clipId; });
    if (idx === -1) return null;
    randomFilter = null;
    repeatClip = null;
    favoritesFilter = null;
    queue = { clips: clips, index: idx };
    return playSingle(clips[idx]);
  }
```
```js
  function playRandomLoop(filter) {
    queue = null;
    repeatClip = null;
    favoritesFilter = null;
    const clip = pickRandom(filter);
    if (!clip) { randomFilter = null; return null; }
    randomFilter = filter || {};
    return playSingle(clip);
  }
```

Update `stopPlayback` (add `favoritesFilter = null;` alongside its existing resets):

```js
  function stopPlayback() {
    queue = null;
    randomFilter = null;
    repeatClip = null;
    favoritesFilter = null;
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    currentAudio = null;
    currentClipId = null;
    notifyChange();
  }
```

Update `advance` (add the `favoritesFilter` branch after the existing `randomFilter` branch):

```js
  function advance() {
    if (repeatClip) { playSingle(repeatClip); return; }
    if (queue) {
      queue.index += 1;
      if (queue.index < queue.clips.length) { playSingle(queue.clips[queue.index]); return; }
      queue = null;
    } else if (randomFilter) {
      const next = pickRandom(randomFilter);
      if (next) { playSingle(next); return; }
      randomFilter = null;
    } else if (favoritesFilter) {
      const next = pickFavoriteWeighted(favoritesFilter);
      if (next) { playSingle(next); return; }
      favoritesFilter = null;
    }
    notifyChange();
  }
```

Update `mediaSessionNext`/`mediaSessionPrevious` to take a 4th param:

```js
  function mediaSessionNext(queueState, randomFilterState, repeatClipState, favoritesFilterState) {
    if (repeatClipState) return { type: 'restart' };
    if (queueState) {
      const idx = queueState.index + 1;
      if (idx < queueState.clips.length) return { type: 'clip', clip: queueState.clips[idx], index: idx };
      return { type: 'none' };
    }
    if (randomFilterState) {
      const next = pickRandom(randomFilterState);
      return next ? { type: 'clip', clip: next, index: null } : { type: 'none' };
    }
    if (favoritesFilterState) {
      const next = pickFavoriteWeighted(favoritesFilterState);
      return next ? { type: 'clip', clip: next, index: null } : { type: 'none' };
    }
    return { type: 'none' };
  }

  function mediaSessionPrevious(queueState, randomFilterState, repeatClipState, currentTimeSeconds, favoritesFilterState) {
    if (repeatClipState) return { type: 'restart' };
    if (randomFilterState || favoritesFilterState) return { type: 'none' };
    if (queueState) {
      if (currentTimeSeconds > 3) return { type: 'restart' };
      const idx = queueState.index - 1;
      if (idx >= 0) return { type: 'clip', clip: queueState.clips[idx], index: idx };
      return { type: 'restart' };
    }
    return { type: 'none' };
  }
```

Find their call sites (inside `setupMediaSessionHandlers`, search for `mediaSessionNext(queue`) and add the extra arg:

```js
    navigator.mediaSession.setActionHandler('nexttrack', function () {
      applyMediaSessionResult(mediaSessionNext(queue, randomFilter, repeatClip, favoritesFilter));
    });
    navigator.mediaSession.setActionHandler('previoustrack', function () {
      applyMediaSessionResult(mediaSessionPrevious(queue, randomFilter, repeatClip, currentAudio ? currentAudio.currentTime : 0, favoritesFilter));
    });
```

Finally, add `pickFavoriteWeighted: pickFavoriteWeighted,`, `playFavoritesWeightedLoop: playFavoritesWeightedLoop,`, and `isPlayingFavoritesWeighted: isPlayingFavoritesWeighted,` to both export blocks (`updateClip` already exists in both — no new export needed for the favorite-toggle itself, it reuses that existing primitive).

- [ ] **Step 4: Run to verify it passes**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
cd C:\Users\gregm\hype-audio-app
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "feat(transcript): add favorites-weighted shuffle mode to hype-audio.js"
```

---

### Task 3: Sync hype-audio.js to Row

**Files:**
- Modify: `C:\Users\gregm\row\hype-audio.js` (copy from this repo)

- [ ] **Step 1: Copy and verify identical**

```bash
cp C:\Users\gregm\hype-audio-app\hype-audio.js C:\Users\gregm\row\hype-audio.js
diff C:\Users\gregm\row\hype-audio.js C:\Users\gregm\hype-audio-app\hype-audio.js
```

Expected: no output (identical).

- [ ] **Step 2: Run Row's own selfcheck to confirm nothing broke there**

```bash
cd C:\Users\gregm\row
node hype-audio.selfcheck.cjs
```

Expected: `hype-audio.selfcheck.cjs: all assertions passed` (Row's copy is `.cjs`, fixed for the ESM/CJS issue during the earlier Row-fusion feature — this step confirms the newly-synced content still passes under that fix).

- [ ] **Step 3: Commit in the Row repo**

```bash
cd C:\Users\gregm\row
git add hype-audio.js
git commit -m "sync: pull in searchClips/quotePreview/favorites-weighted-shuffle from hype-audio-app"
git push
```

---

### Task 4: Global search UI (Home screen)

**Files:**
- Modify: `index.html:216-221` (`view-home` markup)
- Modify: `index.html` (script section, near the other DOMContentLoaded-independent wiring)

- [ ] **Step 1: Add the search input + results container**

Replace:
```html
  <div id="view-home">
    <div class="home-eyebrow">Mental Armory</div>
    <h1 class="dash-title">Hype Audio</h1>
    <div class="tiles" id="tiles"></div>
    <div class="moment-row" id="moment-row"></div>
  </div>
```
with:
```html
  <div id="view-home">
    <div class="home-eyebrow">Mental Armory</div>
    <h1 class="dash-title">Hype Audio</h1>
    <input type="search" id="global-search-input" placeholder="Search everything you've said..." style="width: 100%; margin-bottom: 16px; box-sizing: border-box;">
    <div id="global-search-results" style="display:none"></div>
    <div class="tiles" id="tiles"></div>
    <div class="moment-row" id="moment-row"></div>
  </div>
```

- [ ] **Step 2: Add the search wiring + `escapeHtml` helper**

Add near the end of the main script (before `showHome();` at the bottom):

```js
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    document.getElementById('global-search-input').addEventListener('input', function (e) {
      const query = e.target.value;
      const resultsEl = document.getElementById('global-search-results');
      const tilesEl = document.getElementById('tiles');
      const momentRowEl = document.getElementById('moment-row');
      if (!query.trim()) {
        resultsEl.style.display = 'none';
        tilesEl.style.display = '';
        momentRowEl.style.display = '';
        return;
      }
      const results = window.HypeAudio.searchClips(query);
      tilesEl.style.display = 'none';
      momentRowEl.style.display = 'none';
      resultsEl.style.display = '';
      resultsEl.innerHTML = results.length
        ? results.map(function (c) {
            const preview = window.HypeAudio.quotePreview(c, 100);
            return '<div class="clip search-result" data-clip-id="' + c.id + '">' +
              '<div class="clip-info">' +
                '<div class="clip-title">' + escapeHtml(c.title) + '</div>' +
                '<div class="clip-meta">' + escapeHtml(c.pillar) + ' · ' + escapeHtml(c.mentality) + '</div>' +
                (preview ? '<div class="clip-quote">' + escapeHtml(preview) + '</div>' : '') +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="empty-state">No matches</div>';
      resultsEl.querySelectorAll('.search-result').forEach(function (row) {
        row.onclick = function () {
          const clip = results.find(function (c) { return c.id === row.dataset.clipId; });
          if (clip) showSection(clip.pillar, clip.mentality);
        };
      });
    });
```

- [ ] **Step 3: Add the `.clip-quote` CSS**

Add near the other `.clip-*` rules (search for `.clip-meta {`):

```css
  .clip-quote { font-size: 12px; font-style: italic; color: var(--text-tertiary); margin-top: 4px; line-height: 1.4; }
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(transcript): add global search on the home screen"
```

---

### Task 5: Static quote preview per clip row

**Files:**
- Modify: `index.html` (`renderSection`'s clip-row-building loop)

- [ ] **Step 1: Add the preview line**

In `renderSection`, find `info.appendChild(metaEl);` (right after the existing title/meta setup) and add immediately after it:

```js
        const preview = HypeAudio.quotePreview(clip, 80);
        if (preview) {
          const quoteEl = document.createElement('div');
          quoteEl.className = 'clip-quote';
          quoteEl.textContent = '"' + preview + '"';
          info.appendChild(quoteEl);
        }
```

- [ ] **Step 2: Verify live (see Task 8 for the full pass) — quick check now**

Not worth spinning up the server just for this one line; verified together with Task 6/7 in Task 8's full pass.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(transcript): add static quote preview to each clip row"
```

---

### Task 6: Favorite toggle + favorites-weighted shuffle button

**Files:**
- Modify: `index.html` (`renderSection`'s clip-row action loop, and the `randomBtn` wiring area)

- [ ] **Step 1: Add the favorite star button to each clip row**

In `renderSection`, find `const repeatBtn = document.createElement('button');` and add the star button right before it (so it lands between play and repeat in the actual DOM order — the `actions.appendChild` calls below already list `playBtn, repeatBtn, menuWrap` in order, so insert a new `actions.appendChild(favBtn)` between the play and repeat appends):

```js
        const favBtn = document.createElement('button');
        favBtn.className = 'play-btn' + (clip.favorite ? ' favorite-active' : '');
        favBtn.title = clip.favorite ? 'Remove favorite' : 'Mark favorite';
        favBtn.textContent = clip.favorite ? '⭐' : '☆';
        favBtn.onclick = function () {
          HypeAudio.updateClip(clip.id, { favorite: !clip.favorite });
          renderSection(key, mentality);
        };
```

Then change the append order from:
```js
        actions.appendChild(playBtn);
        actions.appendChild(repeatBtn);
        actions.appendChild(menuWrap);
```
to:
```js
        actions.appendChild(playBtn);
        actions.appendChild(favBtn);
        actions.appendChild(repeatBtn);
        actions.appendChild(menuWrap);
```

- [ ] **Step 2: Add the `.favorite-active` CSS**

Near `.clip-actions .play-btn.repeat-active` (search for it):

```css
  .clip-actions .play-btn.favorite-active { background: rgba(255,193,7,0.18); border-color: rgba(255,193,7,0.4); }
```

- [ ] **Step 3: Add the favorites-weighted shuffle button**

Find the existing `<button class="random-play" id="random-play" type="button"></button>` in `view-section` and add right after it:

```html
        <button class="random-play favorites-play" id="favorites-play" type="button"></button>
```

In `renderSection`, right after the existing `randomBtn` wiring block (after its `onclick` assignment closes), add:

```js
      const favBtn2 = document.getElementById('favorites-play');
      const favActive = HypeAudio.isPlayingFavoritesWeighted({ pillar: key, mentality: mentality });
      favBtn2.textContent = favActive ? '■ STOP' : '⭐ FAVORITES';
      favBtn2.style.background = favActive ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #FFC107 0%, #FFC107 100%)';
      favBtn2.onclick = function () {
        if (HypeAudio.isPlayingFavoritesWeighted({ pillar: key, mentality: mentality })) { HypeAudio.stopPlayback(); renderSection(key, mentality); return; }
        const clip = HypeAudio.playFavoritesWeightedLoop({ pillar: key, mentality: mentality });
        if (!clip) { alert('No favorited ' + mentalityLabel(mentality).toLowerCase() + ' clips yet — tap \u2606 on a clip to favorite it.'); return; }
        renderSection(key, mentality);
      };
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(transcript): add favorite toggle + favorites-weighted shuffle button"
```

---

### Task 7: Bulk title-review screen

**Files:**
- Modify: `index.html` (new `view-title-review`, `showHome`/`showSubcats`/`showSection` updates, `renderHome` update)

- [ ] **Step 1: Add the view markup**

Add after the closing `</div>` of `view-section` (find it — it's the block containing `id="clip-list"`):

```html
  <div id="view-title-review" style="display:none; padding: 0 10px">
    <div class="back-row">
      <button class="back-btn" id="title-review-back-btn" type="button">←</button>
      <h1 class="view-title">Review Suggested Titles</h1>
    </div>
    <div id="title-review-list"></div>
  </div>
```

- [ ] **Step 2: Add the conditional link on Home**

In `view-home`'s markup (from Task 4), add after the search input, before `<div class="tiles"`:

```html
    <button id="title-review-link" onclick="showTitleReview()" style="display:none; width:100%; margin-bottom:16px; padding:10px; border-radius:10px; border:1px solid rgba(255,193,7,0.3); background:rgba(255,193,7,0.08); color:#FFC107; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer;"></button>
```

- [ ] **Step 3: Add `showTitleReview`/`renderTitleReview` and update the three existing nav functions**

Add near `showSection` (after it):

```js
    function showTitleReview() {
      if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();
      document.getElementById('view-home').style.display = 'none';
      document.getElementById('view-subcat').style.display = 'none';
      document.getElementById('view-section').style.display = 'none';
      document.getElementById('view-title-review').style.display = '';
      renderTitleReview();
    }

    function renderTitleReview() {
      const list = document.getElementById('title-review-list');
      const pending = HypeAudio.listActiveClips().filter(function (c) {
        return typeof c.suggested_title === 'string' && c.suggested_title.trim() &&
          c.suggested_title.trim() !== (c.title || '').trim();
      });
      list.innerHTML = pending.length ? '' : '<div class="empty-state">No pending title suggestions.</div>';
      pending.forEach(function (clip) {
        const row = document.createElement('div');
        row.className = 'clip';
        row.innerHTML =
          '<div class="clip-info">' +
            '<div class="clip-meta">Current: ' + escapeHtml(clip.title) + '</div>' +
            '<div class="clip-title">Suggested: ' + escapeHtml(clip.suggested_title) + '</div>' +
          '</div>';
        const actions = document.createElement('div');
        actions.className = 'clip-actions';
        const applyBtn = document.createElement('button');
        applyBtn.className = 'play-btn';
        applyBtn.textContent = '✓ Apply';
        applyBtn.onclick = function () {
          HypeAudio.updateClip(clip.id, { title: clip.suggested_title, suggested_title: null });
          renderTitleReview();
        };
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'play-btn';
        dismissBtn.textContent = '✕ Dismiss';
        dismissBtn.onclick = function () {
          HypeAudio.updateClip(clip.id, { suggested_title: null });
          renderTitleReview();
        };
        actions.appendChild(applyBtn);
        actions.appendChild(dismissBtn);
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    document.getElementById('title-review-back-btn').onclick = function () { showHome(); };
```

Now update `showHome`, `showSubcats`, `showSection` (each already has the record-your-own mic-release line at the top) to also hide `view-title-review`:

```js
    function showHome() {
      if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state === 'recording') cancelRecording();
      currentPillar = null;
      currentMentality = null;
      document.getElementById('view-home').style.display = '';
      document.getElementById('view-subcat').style.display = 'none';
      document.getElementById('view-section').style.display = 'none';
      document.getElementById('view-title-review').style.display = 'none';
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
      document.getElementById('view-title-review').style.display = 'none';
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
      document.getElementById('view-title-review').style.display = 'none';
      renderSection(key, mentality);
      renderTabbar();
    }
```

- [ ] **Step 4: Show/hide the Home link based on pending count**

Inside `renderHome()` (find it), add:

```js
      const pendingCount = HypeAudio.listActiveClips().filter(function (c) {
        return typeof c.suggested_title === 'string' && c.suggested_title.trim() &&
          c.suggested_title.trim() !== (c.title || '').trim();
      }).length;
      const reviewLink = document.getElementById('title-review-link');
      if (pendingCount > 0) {
        reviewLink.style.display = '';
        reviewLink.textContent = 'Review ' + pendingCount + ' suggested title' + (pendingCount === 1 ? '' : 's') + ' →';
      } else {
        reviewLink.style.display = 'none';
      }
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(transcript): add bulk title-suggestion review screen"
```

---

### Task 8: Full live verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and set up test data**

Use the Browser pane's `preview_start` with `{name: "hype-audio"}` (port 5557, per the existing `.claude/launch.json` in the main workspace). In the browser console, add a few clips with `transcript_text`/`suggested_title`/`favorite` fields set (mirroring what the migration would produce) so there's something to search/preview/favorite/review without needing the real migration to have run yet.

- [ ] **Step 2: Search**

Type a word known to be in one clip's `transcript_text` into the home search box. Confirm: tiles/moment-row hide, matching result appears with title/pillar/mentality/quote snippet, tapping it navigates to that clip's section. Clear the search box — confirm tiles/moment-row reappear.

- [ ] **Step 3: Quote preview**

Navigate to a section with clips that have `transcript_text`. Confirm each shows an italicized quote line under its mentality/moment meta. Confirm a clip with no `transcript_text` shows no quote line (not an empty one).

- [ ] **Step 4: Favorite toggle + favorites-weighted shuffle**

Tap the ☆ on a clip — confirm it becomes ⭐ and the button visually changes (gold background). Tap "⭐ FAVORITES" — confirm it starts playing and only ever picks from clips in that pillar/mentality (favorited ones should come up disproportionately often across several taps of "⭐ FAVORITES" → stop → start again, though this is probabilistic, not exact). Confirm the existing "PLAY RANDOM" button still works unchanged and stops the favorites loop if it was running (mutual exclusion, the bug fixed in Task 2).

- [ ] **Step 5: Title review**

With at least one clip carrying a `suggested_title` different from its `title`, confirm the Home screen shows the "Review N suggested titles →" link. Tap it — confirm the review screen lists that clip with current/suggested titles. Tap Apply — confirm the clip's real title updates and it drops off the review list. Add another pending clip, tap Dismiss — confirm it drops off the list without changing the title. Confirm the Home link disappears once nothing's pending.

- [ ] **Step 6: Navigation-away correctness**

Navigate: Home → Carl pillar → Carl mentality section → tap "Review N suggested titles" (if visible) or navigate directly via `showTitleReview()` in console → confirm the title-review view shows and the Carl section view is actually hidden (not layered underneath). Navigate back to Home, then to a different pillar's section — confirm `record-clip-details` and `view-title-review` are both correctly hidden, matching each view's exclusivity.

- [ ] **Step 7: Stop the preview server**

```
preview_stop with the serverId from step 1
```

---

### Task 9: Final commit + push

**Files:** none (repo-level, both repos)

- [ ] **Step 1: Confirm all prior task commits are in place**

```bash
cd C:\Users\gregm\hype-audio-app
git log --oneline -8
```

Expected: the 6 feature commits from Tasks 1, 2, 4, 5, 6, 7, most-recent-first.

- [ ] **Step 2: Push both repos**

```bash
cd C:\Users\gregm\hype-audio-app
git push
cd C:\Users\gregm\row
git push
```

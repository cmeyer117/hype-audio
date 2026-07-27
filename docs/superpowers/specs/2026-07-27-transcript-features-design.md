# Transcript Features — Search, Quote Previews, Favorites, Title Review

Date: 2026-07-27
Status: Approved, ready for planning

## Context

Fifth and final item on the hype-audio vision batch. Companion to `docs/superpowers/specs/2026-07-27-transcript-migration-design.md` (in the main Claude workspace repo, since `instagram-cleanup`'s `.gitignore` is a deliberate scripts-only allowlist) — that spec attaches `transcript_text`/`suggested_title` onto matching clips; this spec is everything built on top of that data, all in this repo (`hype-audio-app`'s `index.html`, plus the shared `hype-audio.js` synced into `row`).

Four features, brainstormed together and explicitly wanted "all in one go" rather than staged:

1. Global search across all clips (title + transcript)
2. Static quote preview per clip row
3. Favorite flag + a new favorites-weighted shuffle mode
4. Bulk title-review screen (apply/dismiss `suggested_title`)

All four depend on the migration having run at least once, but the code itself doesn't need to wait — clips without `transcript_text`/`suggested_title` just don't participate in these features (same graceful-absence behavior as the migration spec's "unmatched clips" case).

## Decisions from brainstorming

- **Search**: global, reachable from Home, not scoped to the current pillar/section — the point is finding a clip you can't remember which section it's filed under.
- **Quote preview**: static text snippet per clip row, not live-synced captions during playback (would need segment timestamps, which the migration deliberately doesn't attach).
- **Favorite-weighted shuffle**: a **new, separate** mode alongside the existing "PLAY RANDOM" — that button stays pure-random, untouched.
- **Favorite toggle**: a visible ⭐ button in the clip row's existing action row (next to play/repeat), not buried in the "⋮" menu.
- **Title review**: a dedicated bulk-review screen, not scattered inline indicators per clip.

## Design

### 1. Shared `hype-audio.js` additions (synced to `row` per this repo's duplication convention)

```js
// Case-insensitive substring match across title + transcript_text. A
// personal library of ~1000 clips doesn't need fuzzy-search infra --
// this is deliberately simple.
function searchClips(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return listActiveClips().filter(function (c) {
    return (c.title && c.title.toLowerCase().indexOf(q) !== -1) ||
           (c.transcript_text && c.transcript_text.toLowerCase().indexOf(q) !== -1);
  });
}

// Same first-segment-style truncation the migration uses for
// suggested_title, applied here to transcript_text for the per-row
// preview -- consistent presentation between the two.
function quotePreview(clip, maxLen) {
  maxLen = maxLen || 80;
  if (!clip.transcript_text) return null;
  const text = clip.transcript_text.trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

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
  return favoritesFilter.pillar === filter.pillar && favoritesFilter.mentality === filter.mentality;
}
```

**`advance()` needs one more branch** (currently checks `repeatClip`, then `queue`, then `randomFilter`) to also loop `favoritesFilter`:

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

`stopPlayback()` also needs `favoritesFilter = null;` added alongside its existing resets, for the same reason those three get reset there:

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

Toggling a favorite reuses the existing `updateClip(id, patch)` primitive already in this file — no new function needed: `HypeAudio.updateClip(clip.id, { favorite: !clip.favorite })`.

All of the above gets exported on both `window.HypeAudio` and `module.exports`, matching every other function in this file.

### 2. Global search (Home screen)

A search input added to `view-home` (index.html), above the existing pillar tiles:

```html
<input type="search" id="global-search-input" placeholder="Search everything you've said..." style="width: 100%; margin-bottom: 16px;">
<div id="global-search-results" style="display:none"></div>
```

```js
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
```

`escapeHtml` is new — nothing in this file currently escapes user-provided text before `innerHTML`, but clip titles/transcripts can contain `&`/`<`/`>` from real speech (contractions, comparisons) and this is the first place building an HTML string from clip content the user directly typed/spoke, so it's worth doing correctly here rather than carrying the same gap forward.

### 3. Static quote preview (per clip row)

In `renderSection`'s clip-row-building loop, right after the existing `metaEl` (mentality · moment):

```js
const preview = HypeAudio.quotePreview(clip, 80);
if (preview) {
  const quoteEl = document.createElement('div');
  quoteEl.className = 'clip-quote';
  quoteEl.textContent = '"' + preview + '"';
  info.appendChild(quoteEl);
}
```

(Uses `textContent`, not `innerHTML` — no escaping needed here since it's not being parsed as HTML.)

CSS addition:
```css
.clip-quote { font-size: 12px; font-style: italic; color: var(--text-tertiary); margin-top: 4px; line-height: 1.4; }
```

### 4. Favorite toggle + favorites-weighted shuffle button

In the clip-row action loop, a new star button added between `playBtn` and `repeatBtn`:

```js
const favBtn = document.createElement('button');
favBtn.className = 'play-btn' + (clip.favorite ? ' favorite-active' : '');
favBtn.title = clip.favorite ? 'Remove favorite' : 'Mark favorite';
favBtn.textContent = clip.favorite ? '⭐' : '☆';
favBtn.onclick = function () {
  HypeAudio.updateClip(clip.id, { favorite: !clip.favorite });
  renderSection(key, mentality);
};
actions.appendChild(favBtn); // inserted before repeatBtn in the actual append order
```

CSS: `.play-btn.favorite-active { background: rgba(255,193,7,0.18); border-color: rgba(255,193,7,0.4); }` (same gold accent the PR-rant button uses in Row, for visual consistency across the two apps' shared feature family).

A new button next to the existing "PLAY RANDOM" button in `renderSection` (index.html, near the existing `randomBtn` wiring):

```html
<button class="favorites-play" id="favorites-play" type="button"></button>
```
```js
const favBtn2 = document.getElementById('favorites-play');
const favActive = HypeAudio.isPlayingFavoritesWeighted({ pillar: key, mentality: mentality });
favBtn2.textContent = favActive ? '■ STOP' : '⭐ FAVORITES';
favBtn2.onclick = function () {
  if (HypeAudio.isPlayingFavoritesWeighted({ pillar: key, mentality: mentality })) { HypeAudio.stopPlayback(); renderSection(key, mentality); return; }
  const clip = HypeAudio.playFavoritesWeightedLoop({ pillar: key, mentality: mentality });
  if (!clip) { alert('No ' + mentalityLabel(mentality) + ' clips yet — upload one below.'); return; }
  renderSection(key, mentality);
};
```

### 5. Bulk title-review screen

A new view (`view-title-review`), reachable via a link from Home (only shown if at least one clip has a pending `suggested_title`):

```html
<div id="view-title-review" style="display:none; padding: 0 10px">
  <div class="back-row">
    <button class="back-btn" id="title-review-back-btn" type="button">←</button>
    <h1 class="view-title">Review Suggested Titles</h1>
  </div>
  <div id="title-review-list"></div>
</div>
```

```js
function showTitleReview() {
  document.getElementById('view-home').style.display = 'none';
  document.getElementById('view-subcat').style.display = 'none';
  document.getElementById('view-section').style.display = 'none';
  document.getElementById('view-title-review').style.display = '';
  renderTitleReview();
}

function renderTitleReview() {
  const list = document.getElementById('title-review-list');
  const pending = HypeAudio.listActiveClips().filter(function (c) {
    return c.suggested_title && c.suggested_title !== c.title;
  });
  list.innerHTML = pending.length
    ? ''
    : '<div class="empty-state">No pending title suggestions.</div>';
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

Home screen link, shown conditionally:
```js
const pendingCount = HypeAudio.listActiveClips().filter(function (c) { return c.suggested_title && c.suggested_title !== c.title; }).length;
const reviewLink = document.getElementById('title-review-link');
if (pendingCount > 0) {
  reviewLink.style.display = '';
  reviewLink.textContent = 'Review ' + pendingCount + ' suggested title' + (pendingCount === 1 ? '' : 's') + ' →';
} else {
  reviewLink.style.display = 'none';
}
```
(`<button id="title-review-link" onclick="showTitleReview()" style="display:none"></button>` added to `view-home`, this line added inside `renderHome()`.)

## Testing

`searchClips`, `quotePreview`, and `pickFavoriteWeighted` are pure functions — worth adding to `hype-audio.selfcheck.js` (this repo's own copy) following the existing pattern: a mix of favorited/non-favorited clips, confirm `searchClips` matches on both title and transcript substrings case-insensitively and returns `[]` for no match, confirm `quotePreview` truncates correctly and returns `null` with no `transcript_text`, confirm `pickFavoriteWeighted` only returns clips from the pool it should include (weighting itself isn't asserted exactly since it's random, just pool membership). `advance()`'s new `favoritesFilter` branch and the toggle/UI wiring are DOM glue, live-verified instead — same split this repo already uses elsewhere.

## Out of scope

- The migration itself (companion spec).
- Editing `transcript_text` in the app (read-only, sourced from the migration).
- Search result ranking/relevance scoring beyond substring match.

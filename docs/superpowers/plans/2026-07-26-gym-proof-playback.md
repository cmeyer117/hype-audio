# Gym-Proof Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lock-screen media controls (Media Session API) and offline playback (PWA service worker) to the hype-audio-app static site, with zero changes to existing playback semantics.

**Architecture:** Three new files (`manifest.json`, `sw.js`, plus this plan's self-checks) and two small, additive changes to existing files (`hype-audio.js` gains Media Session wiring + pure mode-aware skip logic; `index.html` gains manifest link, theme-color meta, service worker registration, and one artwork-resolver wire-up call).

**Tech Stack:** Plain JS (no build step, matches existing codebase), Web Manifest spec, Service Worker API, Media Session API. Tests follow the existing `*.selfcheck.js` pattern (plain `assert`-based, run with `node`, no test framework).

**Spec:** `docs/superpowers/specs/2026-07-26-gym-proof-playback-design.md`

---

### Task 1: PWA manifest

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "name": "Hype Audio",
  "short_name": "Hype Audio",
  "start_url": "/index.html",
  "display": "standalone",
  "background_color": "#0a0a0b",
  "theme_color": "#0a0a0b",
  "icons": [
    { "src": "images/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "images/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "Add PWA manifest"
```

Note: `images/icon-192.png` and `images/icon-512.png` don't exist yet (Task 7 covers generating them) — the manifest referencing missing files is harmless; browsers just won't show an icon until the files land.

---

### Task 2: Service worker — pure routing logic + self-check

**Files:**
- Create: `sw.js`
- Test: `sw.selfcheck.js`

- [ ] **Step 1: Write the failing test**

```js
// Run with: node sw.selfcheck.js
'use strict';

const { isAudioClipRequest } = require('./sw.js');

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL: ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exit(1);
  }
}

assertEqual(
  isAudioClipRequest('https://vikpcejlyxieguorwysf.supabase.co/storage/v1/object/public/hype-audio/clip_123_abc.mp3'),
  true,
  'a Supabase hype-audio storage URL is treated as an audio clip request'
);
assertEqual(
  isAudioClipRequest('https://hype-audio-app.vercel.app/index.html'),
  false,
  'the app shell HTML is not treated as an audio clip request'
);
assertEqual(
  isAudioClipRequest('https://hype-audio-app.vercel.app/hype-audio.js'),
  false,
  'a core JS file is not treated as an audio clip request'
);
assertEqual(
  isAudioClipRequest('https://vikpcejlyxieguorwysf.supabase.co/storage/v1/object/public/other-bucket/file.mp3'),
  false,
  'a different Supabase storage bucket is not treated as an audio clip request'
);

console.log('sw.selfcheck.js: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node sw.selfcheck.js` (from `C:\Users\gregm\hype-audio-app`)
Expected: `Error: Cannot find module './sw.js'` (file doesn't exist yet)

- [ ] **Step 3: Write `sw.js`**

```js
// Service worker: app shell is network-first (always fetch latest when
// online, fall back to cache offline); audio clips are cache-first and
// populated lazily the first time each one is actually played
// (cache-as-played, not eager) -- see docs/superpowers/specs/2026-07-26-gym-proof-playback-design.md.
'use strict';

const APP_SHELL_CACHE = 'hype-audio-shell-v1';
const AUDIO_CACHE = 'hype-audio-clips-v1';

function isAudioClipRequest(url) {
  return url.indexOf('/storage/v1/object/public/hype-audio/') !== -1;
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
    });
  });
}

function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request)
      .then(function (response) {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(function () {
        return cache.match(request);
      });
  });
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', function (event) {
    self.skipWaiting();
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    const url = event.request.url;
    if (isAudioClipRequest(url)) {
      event.respondWith(cacheFirst(event.request, AUDIO_CACHE));
    } else {
      event.respondWith(networkFirst(event.request, APP_SHELL_CACHE));
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAudioClipRequest: isAudioClipRequest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node sw.selfcheck.js`
Expected: `sw.selfcheck.js: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add sw.js sw.selfcheck.js
git commit -m "Add service worker: network-first app shell, cache-as-played audio clips"
```

---

### Task 3: Media Session — pure mode-aware skip logic + self-check

**Files:**
- Modify: `hype-audio.js`
- Test: `hype-audio.selfcheck.js`

This adds two pure functions — `mediaSessionNext` / `mediaSessionPrevious` — that decide what a lock-screen skip button should do, given the module's three mutually-exclusive play-mode states (`queue`, `randomFilter`, `repeatClip`). They take those states as explicit arguments (not closure reads) so they're testable exactly like `pickRandom` already is.

- [ ] **Step 1: Write the failing tests**

Append to `hype-audio.selfcheck.js` (before the final `console.log` line):

```js
// mediaSessionNext / mediaSessionPrevious -- pure decision functions for
// lock-screen skip buttons, mode-aware across the three play modes.
const queueState = { clips: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], index: 0 };

// Sequential (queue) mode
assertEqual(
  HypeAudio.mediaSessionNext(queueState, null, null),
  { type: 'clip', clip: { id: 'b' }, index: 1 },
  'nexttrack in sequential mode advances to the next clip in the queue'
);
assertEqual(
  HypeAudio.mediaSessionNext({ clips: [{ id: 'a' }, { id: 'b' }], index: 1 }, null, null),
  { type: 'none' },
  'nexttrack at the end of the queue does nothing'
);
assertEqual(
  HypeAudio.mediaSessionPrevious(queueState, null, null, 5),
  { type: 'restart' },
  'previoustrack more than 3s into a clip restarts it instead of going back'
);
assertEqual(
  HypeAudio.mediaSessionPrevious(queueState, null, null, 1),
  { type: 'restart' },
  'previoustrack within 3s at the start of the queue restarts the current (first) clip'
);
assertEqual(
  HypeAudio.mediaSessionPrevious({ clips: [{ id: 'a' }, { id: 'b' }], index: 1 }, null, null, 1),
  { type: 'clip', clip: { id: 'a' }, index: 0 },
  'previoustrack within 3s and not at the start goes back one clip'
);

// Random loop mode
const randomNext = HypeAudio.mediaSessionNext(null, { pillar: 'mindset' }, null);
assertEqual(randomNext.type, 'clip', 'nexttrack in random-loop mode returns a fresh clip from the filter');
assertEqual(randomNext.index, null, 'nexttrack in random-loop mode has no queue index to update');
assertEqual(
  HypeAudio.mediaSessionNext(null, { pillar: 'nonexistent-pillar' }, null),
  { type: 'none' },
  'nexttrack in random-loop mode with no matching clips does nothing'
);
assertEqual(
  HypeAudio.mediaSessionPrevious(null, { pillar: 'mindset' }, null, 1),
  { type: 'none' },
  'previoustrack in random-loop mode does nothing -- no meaningful "previous" in an infinite random stream'
);

// Repeat mode
assertEqual(
  HypeAudio.mediaSessionNext(null, null, { id: 'a' }),
  { type: 'restart' },
  'nexttrack in repeat mode restarts the current clip rather than skipping'
);
assertEqual(
  HypeAudio.mediaSessionPrevious(null, null, { id: 'a' }, 1),
  { type: 'restart' },
  'previoustrack in repeat mode restarts the current clip'
);

// No active mode
assertEqual(
  HypeAudio.mediaSessionNext(null, null, null),
  { type: 'none' },
  'nexttrack with no active play mode does nothing'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node hype-audio.selfcheck.js` (from `C:\Users\gregm\hype-audio-app`)
Expected: `TypeError: HypeAudio.mediaSessionNext is not a function`

- [ ] **Step 3: Implement in `hype-audio.js`**

Add above `function playSingle(clip) {` (after the `isPlayingRepeat` function):

```js
  // Pure decision functions for lock-screen (Media Session) skip buttons.
  // Take the three play-mode states as explicit args rather than reading
  // module closure vars directly, so they're unit-testable the same way
  // pickRandom() is -- see docs/superpowers/specs/2026-07-26-gym-proof-playback-design.md.
  function mediaSessionNext(queueState, randomFilterState, repeatClipState) {
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
    return { type: 'none' };
  }

  function mediaSessionPrevious(queueState, randomFilterState, repeatClipState, currentTimeSeconds) {
    if (repeatClipState) return { type: 'restart' };
    if (randomFilterState) return { type: 'none' };
    if (queueState) {
      if (currentTimeSeconds > 3) return { type: 'restart' };
      const idx = queueState.index - 1;
      if (idx >= 0) return { type: 'clip', clip: queueState.clips[idx], index: idx };
      return { type: 'restart' };
    }
    return { type: 'none' };
  }
```

Note: the `mediaSessionNext` random-loop branch returns `index: null` because random-loop mode has no `queue` to index into — callers must check `result.type === 'clip'` and only touch `queue.index` when a real queue is active (wired in Task 4).

- [ ] **Step 4: Export from both `window.HypeAudio` and `module.exports`**

In the `window.HypeAudio = { ... }` block, add after `isPlayingRepeat: isPlayingRepeat,`:

```js
      mediaSessionNext: mediaSessionNext,
      mediaSessionPrevious: mediaSessionPrevious,
```

In the `module.exports = { ... }` block, add after `pickRandom: pickRandom,`:

```js
      mediaSessionNext: mediaSessionNext,
      mediaSessionPrevious: mediaSessionPrevious,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

- [ ] **Step 6: Commit**

```bash
git add hype-audio.js hype-audio.selfcheck.js
git commit -m "Add mode-aware pure decision functions for lock-screen skip buttons"
```

---

### Task 4: Wire Media Session metadata + action handlers into playback

**Files:**
- Modify: `hype-audio.js`

This wires the pure functions from Task 3 into real `navigator.mediaSession` calls, and sets lock-screen metadata (title + artwork) every time a clip starts. Artwork comes from an app-supplied resolver (`setArtworkResolver`) rather than hype-audio.js reaching into `CLIP_ART_MANIFEST` directly — that manifest and its `images/clips/` assets are `hype-audio-app`-specific UI concerns, and this file is shared byte-for-byte with the `row` repo, which has no such assets.

- [ ] **Step 1: Add the artwork resolver and metadata/handler setup**

Add above `function playSingle(clip) {` (after the `mediaSessionPrevious` function from Task 3):

```js
  // App-supplied hook for resolving a clip's lock-screen artwork URL --
  // registered by the consuming page (index.html calls
  // HypeAudio.setArtworkResolver(mentalityArt)). Optional; without it,
  // metadata still shows a title, just no artwork image.
  let artworkResolver = null;
  function setArtworkResolver(fn) { artworkResolver = fn; }

  function updateMediaSessionMetadata(clip) {
    if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: clip.title,
      artwork: artworkResolver ? [{ src: artworkResolver(clip), sizes: '512x512', type: 'image/png' }] : [],
    });
  }

  function applyMediaSessionResult(result) {
    if (result.type === 'clip') {
      if (result.index !== null && queue) queue.index = result.index;
      playSingle(result.clip);
    } else if (result.type === 'restart' && currentAudio) {
      currentAudio.currentTime = 0;
      currentAudio.play().catch(function () {});
    }
  }

  function setupMediaSessionHandlers() {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler('play', function () {
      if (currentAudio) currentAudio.play().catch(function () {});
    });
    navigator.mediaSession.setActionHandler('pause', function () {
      if (currentAudio) currentAudio.pause();
    });
    navigator.mediaSession.setActionHandler('nexttrack', function () {
      applyMediaSessionResult(mediaSessionNext(queue, randomFilter, repeatClip));
    });
    navigator.mediaSession.setActionHandler('previoustrack', function () {
      applyMediaSessionResult(mediaSessionPrevious(queue, randomFilter, repeatClip, currentAudio ? currentAudio.currentTime : 0));
    });
  }
```

- [ ] **Step 2: Call `updateMediaSessionMetadata` from `playSingle`**

In `playSingle`, immediately after `currentClipId = clip.id;`, add:

```js
    updateMediaSessionMetadata(clip);
```

So `playSingle` reads:

```js
  function playSingle(clip) {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    const audio = new Audio(clip.storage_url);
    currentAudio = audio;
    currentClipId = clip.id;
    updateMediaSessionMetadata(clip);
    audio.onplay = notifyChange;
    audio.onpause = notifyChange;
    audio.onended = function () { currentClipId = null; advance(); };
    audio.play().catch(function () {});
    updateClip(clip.id, { play_count: (clip.play_count || 0) + 1 });
    notifyChange();
    return audio;
  }
```

- [ ] **Step 3: Add an offline-playback-failure message**

In `playSingle`, add an `onerror` handler right after `audio.onended`:

```js
    audio.onerror = function () {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('This clip isn\'t downloaded yet -- needs a connection to play for the first time.');
      }
    };
```

- [ ] **Step 4: Call `setupMediaSessionHandlers()` once at module load**

In the `if (typeof window !== 'undefined') { window.HypeAudio = { ... }; }` block, add a call right after the `window.HypeAudio = { ... };` assignment closes:

```js
    setupMediaSessionHandlers();
```

- [ ] **Step 5: Export `setArtworkResolver` from `window.HypeAudio`**

Add to the `window.HypeAudio = { ... }` object, after `mediaSessionPrevious: mediaSessionPrevious,`:

```js
      setArtworkResolver: setArtworkResolver,
```

(Not needed in `module.exports` — that block is for the Node-side migration-script consumers, which never touch playback/artwork.)

- [ ] **Step 6: Run the existing self-check to confirm nothing broke**

Run: `node hype-audio.selfcheck.js`
Expected: `hype-audio.selfcheck.js: all assertions passed`

(This file doesn't create real `Audio`/`navigator` objects, so `playSingle`'s new lines are guarded by the same `typeof navigator === 'undefined'` checks and never execute in this Node run -- no new shims needed.)

- [ ] **Step 7: Commit**

```bash
git add hype-audio.js
git commit -m "Wire Media Session metadata and lock-screen action handlers into playback"
```

---

### Task 5: index.html — manifest link, theme-color, service worker registration, artwork resolver

**Files:**
- Modify: `index.html:5` (viewport meta area)
- Modify: `index.html:281` (after the `hype-audio.js` script tag)
- Modify: `index.html:331` (after `mentalityArt` is defined)

- [ ] **Step 1: Add manifest link and theme-color meta**

In the `<head>`, right after the existing viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#0a0a0b">
```

- [ ] **Step 2: Register the service worker**

Right after `<script src="hype-audio.js"></script>`, add a new small script block:

```html
  <script src="hype-audio.js"></script>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  </script>
```

- [ ] **Step 3: Wire the artwork resolver**

Right after the `function mentalityArt(m) { ... }` line:

```js
    function mentalityArt(m) { return 'images/clips/' + (Object.hasOwn(CLIP_ART_MANIFEST, m) ? CLIP_ART_MANIFEST[m] : CLIP_ART_MANIFEST.default); }
    HypeAudio.setArtworkResolver(mentalityArt);
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Link PWA manifest, register service worker, wire lock-screen artwork resolver"
```

---

### Task 6: Sync `hype-audio.js` to the `row` repo

**Files:**
- Modify: `C:\Users\gregm\row\hype-audio.js` (copy from this repo)

`hype-audio.js` is kept byte-identical between `hype-audio-app` and `row` (established convention -- `row`'s `gym.html` mini-player shares the same core lib and Supabase `app_state` row). `row` has no per-clip UI and no `mentality-art`-style asset manifest, so it never calls `setArtworkResolver` -- Media Session metadata will just show a title with no artwork there, which is correct and requires no `row`-side code changes beyond the copy.

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
git commit -m "Sync hype-audio.js: Media Session lock-screen controls"
```

---

### Task 7: Generate the app icon (manual, Carl)

**Files:**
- Create: `images/icon-192.png`, `images/icon-512.png` (Carl-supplied, via ChatGPT per the standing image-gen rule)

- [ ] **Step 1: Hand Carl this ChatGPT prompt**

> Generate a square app icon, 1024x1024px, for a fitness motivation app called "Hype Audio." Dark near-black background (#0a0a0b). Centered mark: a bold, minimal sound-wave or lightning-bolt glyph, using a warm gradient that blends red-orange (#E0332F) into deep purple (#8E7CF0) into gold (#C9A227) -- the same three colors as the app's existing wordmark gradient. No text, no wordmark, no photographic elements -- flat/vector icon style, must read clearly at small sizes (like a phone home-screen icon). Square canvas, no rounded corners (the OS applies its own icon mask).

- [ ] **Step 2: Resize and save**

Carl saves the generated image as both:
- `images/icon-192.png` (192x192)
- `images/icon-512.png` (512x512)

- [ ] **Step 3: Commit**

```bash
git add images/icon-192.png images/icon-512.png
git commit -m "Add PWA app icons"
```

---

### Task 8: Push and live-verify

**Files:** none (verification only)

- [ ] **Step 1: Push all commits**

```bash
cd /c/Users/gregm/hype-audio-app && git push origin master
cd /c/Users/gregm/row && git push origin master
```

- [ ] **Step 2: Confirm Vercel deploy**

Wait ~1-2 min, then check `https://hype-audio-app.vercel.app` loads with no console errors (Browser pane: `read_console_messages` with `onlyErrors: true`).

- [ ] **Step 3: Confirm service worker registered**

Via `javascript_tool` in the Browser pane against the live site:

```js
navigator.serviceWorker.getRegistrations().then(function (regs) { return regs.length; });
```

Expected: `1`

- [ ] **Step 4: Manual on-device verification (Carl, real phone -- the Browser pane cannot simulate lock-screen or a real network dead zone)**

- Open the live site on your phone, "Add to Home Screen."
- Play a clip, lock the phone -- confirm the lock screen shows the clip title and play/pause/skip controls that work.
- Play a clip to completion once (so it's cached), then enable Airplane Mode and replay that same clip from the app -- should still play.
- With Airplane Mode still on, try a clip never played before -- should show the "needs a connection" message rather than failing silently.
- Turn Airplane Mode back off.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-26-gym-proof-playback.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

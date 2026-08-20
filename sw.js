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

// Audio elements (Safari especially) issue Range-header requests for
// playback/seeking. These clips are short enough that streaming/seek
// support isn't needed, so we always fetch/cache/serve the complete file --
// stripping Range here avoids caching partial 206 responses keyed by URL
// that would miss or serve corrupt data on a later, differently-ranged
// request (see docs/superpowers/specs/2026-07-26-gym-proof-playback-design.md).
function stripRangeRequest(request) {
  if (!request.headers.has('range')) return request;
  const headers = new Headers(request.headers);
  headers.delete('range');
  return new Request(request.url, { method: request.method, headers: headers });
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
      event.respondWith(cacheFirst(stripRangeRequest(event.request), AUDIO_CACHE));
    } else if (url.indexOf(self.location.origin) === 0) {
      event.respondWith(networkFirst(event.request, APP_SHELL_CACHE));
    }
    // else: cross-origin, non-clip request (Supabase REST/Realtime, etc.) --
    // leave uninterrupted so the browser handles it directly. The app-shell
    // cache used to catch these too; caching a Supabase API response risked
    // serving stale personal sync state as if it were fresh once offline
    // (found via Codex audit 2026-08-20).
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAudioClipRequest: isAudioClipRequest, stripRangeRequest: stripRangeRequest };
}

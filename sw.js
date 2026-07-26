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

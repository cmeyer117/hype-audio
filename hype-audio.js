// Hype Audio — shared core logic (metadata list + Storage upload).
// This repo is the canonical copy; Row's copy is re-synced from here by
// hand whenever this file changes (Row doesn't use uploadClipFile --
// gym.html only calls playMidSetHype/playPrRant -- but keeping it
// byte-identical means the mini-player playback fixes always carry over
// too). Row's sync.js is NOT kept in sync -- it has its own real
// divergence for Row's owner-auth token handling. No build step, no bundler.
(function () {
  'use strict';
  const LS_KEY = 'hype_audio';

  function listClips() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveClips(clips) {
    localStorage.setItem(LS_KEY, JSON.stringify(clips));
  }

  function addClip(meta) {
    const clips = listClips();
    clips.push(Object.assign({ updated_at: Date.now() }, meta));
    saveClips(clips);
  }

  function updateClip(id, patch) {
    const clips = listClips();
    const idx = clips.findIndex((c) => c.id === id);
    if (idx === -1) return;
    clips[idx] = Object.assign({}, clips[idx], patch, { updated_at: Date.now() });
    saveClips(clips);
  }

  // Soft-delete: mark instead of remove. A plain removal would make the
  // clip disappear from this device's array but not the shared one, and
  // the cloud-sync merge (sync.js's mergeArrays) can't tell "never synced
  // this clip" apart from "deleted this clip" once it's just gone — it
  // would add the clip back on the next merge from another device/tab
  // that still has it. A tombstone is data, so it survives the merge and
  // propagates the delete instead of getting merged away.
  // ponytail: tombstones are never pruned — fine at solo-user clip-count
  // scale, add pruning (drop tombstones older than N days) if the list grows.
  function deleteClip(id) {
    const clips = listClips();
    const idx = clips.findIndex((c) => c.id === id);
    if (idx === -1) return;
    clips[idx] = Object.assign({}, clips[idx], { deleted: true, deleted_at: Date.now(), updated_at: Date.now() });
    saveClips(clips);
  }

  function listActiveClips() {
    return listClips().filter((c) => !c.deleted);
  }

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

  // Rest-timer "hype me up" button: prefers a mid_set-tagged clip; falls
  // back to the same iron/mindset/carl pillar pool the "Hype Me Up" home
  // button already draws from, so the button isn't dead on arrival while
  // the mid_set pool is still empty (see docs/superpowers/specs/2026-07-27-hype-audio-row-fusion-design.md).
  function pickMidSetClip() {
    return pickRandom({ moment: 'mid_set' }) || pickRandom({ pillar: ['iron', 'mindset', 'carl'] });
  }

  // 2026-07-27: Carl decided he wants this on immediately (no tap needed) --
  // the mid-set hype clip and PR rant now auto-play as soon as a set is
  // logged. gym.html's startRestTimer is the call site that reads this flag.
  const AUTO_PLAY_HYPE = true;

  function playMidSetHype() {
    const clip = pickMidSetClip();
    if (clip) playClip(clip);
    return clip;
  }

  function playPrRant() {
    const clip = pickRandom({ pillar: 'carl' });
    if (clip) playClip(clip);
    return clip;
  }

  // Only one clip should ever be audible at once — module-level handle so a
  // second playClip() call stops whatever's already playing instead of layering.
  let currentAudio = null;
  let currentClipId = null;
  // Consecutive playback errors while looping -- reset on any successful
  // play, so one dead storage_url skips ahead but an all-broken pool (or a
  // dead network that navigator.onLine missed) can't spin forever.
  let errorStreak = 0;
  let onChangeCb = null;
  // Auto-advance state: at most one of these is active at a time. `queue` is
  // a fixed snapshot (list + position) for "play down the list from here";
  // `randomFilter` re-picks a new random clip matching the filter every time
  // one ends, looping until stopped. Starting either cancels the other.
  let queue = null;
  let randomFilter = null;
  let repeatClip = null;

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

  // Ephemeral, never synced -- reset by every mode-starter (playClip,
  // playRepeat, playFromList, playRandomLoop, playFavoritesWeightedLoop)
  // and by stopPlayback, same trigger points as errorStreak. Scoped to "the
  // current playback session," not to any one filter -- without the reset,
  // clips played via one pool (e.g. a broad moment loop) would suppress
  // themselves from an unrelated pool's picks too (code review, 2026-08-17).
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

  function notifyChange() { if (onChangeCb) onChangeCb(); }

  // Subscribe to play/pause/end state changes so the UI can re-render the
  // right row's play/pause icon without polling.
  function onPlaybackChange(cb) { onChangeCb = cb; }

  function isPlaying(clipId) {
    return currentClipId === clipId && !!currentAudio && !currentAudio.paused;
  }

  // The clip currently loaded (playing OR paused), null once it ends or
  // playback is stopped -- what the now-playing bar renders from. A fresh
  // lookup rather than a held reference, same reasoning as onplay's
  // play_count fix: a held clip object goes stale (repeat mode reuses one
  // object forever) and self-heals metadata edited mid-playback for free.
  function getCurrentClip() {
    return currentClipId ? listClips().find(function (c) { return c.id === currentClipId; }) || null : null;
  }

  // Unlike isPlaying(), true whether the clip is playing OR paused -- used to
  // tell "resume/pause this row" apart from "start a fresh queue from here".
  function isCurrent(clipId) { return currentClipId === clipId && !!currentAudio; }

  function isPlayingRandom() { return !!randomFilter; }

  // Distinguishes "random-looping this moment" (home-screen PRE/MID-SET/POST
  // buttons) from "a pillar's own PLAY RANDOM" -- both share randomFilter,
  // but a moment-mode call never sets pillar and a pillar's own random loop
  // never sets moment. See docs/superpowers/specs/2026-07-26-moment-modes-design.md.
  function isPlayingMoment(moment) {
    return !!randomFilter && randomFilter.moment === moment && !randomFilter.pillar;
  }

  // Exact-match check for a specific PLAY RANDOM button (a pillar's own, or
  // a mentality-scoped one within it) -- distinct from isPlayingRandom(),
  // which is just !!randomFilter and can't tell "this exact filter" from
  // "any random loop at all" (e.g. a moment-mode loop, or a more/less
  // specific filter within the same pillar).
  function isPlayingRandomFilter(filter) {
    if (!randomFilter) return false;
    filter = filter || {};
    return randomFilter.pillar === filter.pillar && randomFilter.mentality === filter.mentality && randomFilter.moment === filter.moment;
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
    const eligible = filterEligiblePool(pool);
    const weighted = [];
    eligible.forEach(function (c) {
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
    errorStreak = 0;
    recentlyPlayed = [];
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

  function isPlayingRepeat(clipId) { return !!repeatClip && repeatClip.id === clipId; }

  // Pure decision functions for lock-screen (Media Session) skip buttons.
  // Take the three play-mode states as explicit args rather than reading
  // module closure vars directly, so they're unit-testable the same way
  // pickRandom() is -- see docs/superpowers/specs/2026-07-26-gym-proof-playback-design.md.
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
      applyMediaSessionResult(mediaSessionNext(queue, randomFilter, repeatClip, favoritesFilter));
    });
    navigator.mediaSession.setActionHandler('previoustrack', function () {
      applyMediaSessionResult(mediaSessionPrevious(queue, randomFilter, repeatClip, currentAudio ? currentAudio.currentTime : 0, favoritesFilter));
    });
  }

  // Internal: plays exactly one clip and wires its natural end to advance()
  // -- the only thing that knows about queue/randomFilter. A user pause
  // never advances (onpause isn't wired to it), only a clip actually ending.
  function playSingle(clip) {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    const audio = new Audio(clip.storage_url);
    currentAudio = audio;
    currentClipId = clip.id;
    updateMediaSessionMetadata(clip);
    // play_count increments on the real onplay event, not right after calling
    // .play() -- that promise can reject (autoplay policy, offline, a bad
    // storage_url) with no audio ever actually starting, which used to still
    // count as a play every time (caught in Codex review, worse now that
    // auto-play fires this on every logged set instead of only a manual tap).
    // Once per Audio element: a resume after pause re-fires onplay but is
    // the same listen, not a new one.
    let counted = false;
    audio.onplay = function () {
      // A pause() called before .play()'s promise settles doesn't retract
      // the already-queued 'play' event (a real, documented browser
      // behavior, not a hypothetical) -- without this guard, rapidly
      // skipping past a clip before it audibly starts still recorded a
      // phantom play_count for it once its delayed onplay fired.
      if (audio !== currentAudio) return;
      errorStreak = 0;
      if (!counted) {
        counted = true;
        // Fresh read, not clip.play_count -- `clip` can be a stale snapshot
        // (repeat mode reuses one object forever, so counts never accumulated).
        const fresh = listClips().find(function (c) { return c.id === clip.id; });
        updateClip(clip.id, { play_count: ((fresh && fresh.play_count) || 0) + 1 });
        recentlyPlayed.push(clip.id);
        if (recentlyPlayed.length > RECENT_WINDOW) recentlyPlayed.shift();
      }
      notifyChange();
    };
    audio.onpause = notifyChange;
    audio.onended = function () {
      if (audio !== currentAudio) return; // stale handler after a newer play started
      currentClipId = null;
      advance();
    };
    audio.onerror = function () {
      if (audio !== currentAudio) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('This clip isn\'t downloaded yet -- needs a connection to play for the first time.');
        // Stop cleanly rather than leave a "paused" now-playing bar whose
        // resume button would just re-poke a terminally-errored Audio.
        stopPlayback();
        return;
      }
      // A broken storage_url used to kill the loop silently (onended never
      // fires, nothing advances). Skip ahead instead, with the streak guard
      // above stopping a pool where everything is broken.
      errorStreak += 1;
      currentClipId = null;
      if (errorStreak >= 5) { stopPlayback(); return; }
      advance();
    };
    audio.play().catch(function () {});
    notifyChange();
    return audio;
  }

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

  // Every mode-starter resets errorStreak and recentlyPlayed: both guards
  // are per playback session -- a streak or recency window left over from
  // an earlier session would otherwise leak into a brand-new one (an
  // earlier-session streak could false-stop it on the first error; an
  // earlier-session recentlyPlayed could suppress clips in a pool that
  // never actually played anything yet).
  function playClip(clip) {
    queue = null;
    randomFilter = null;
    repeatClip = null;
    favoritesFilter = null;
    errorStreak = 0;
    recentlyPlayed = [];
    return playSingle(clip);
  }

  // Repeats one clip over and over until stopPlayback() or a different
  // clip/mode is chosen.
  function playRepeat(clip) {
    queue = null;
    randomFilter = null;
    repeatClip = clip;
    favoritesFilter = null;
    errorStreak = 0;
    recentlyPlayed = [];
    return playSingle(clip);
  }

  // Plays clipId and continues sequentially through the rest of `clips`
  // (the exact array passed in, e.g. the currently-rendered/filtered list)
  // until it reaches the end or gets interrupted.
  function playFromList(clips, clipId) {
    const idx = clips.findIndex(function (c) { return c.id === clipId; });
    if (idx === -1) return null;
    randomFilter = null;
    repeatClip = null;
    favoritesFilter = null;
    errorStreak = 0;
    recentlyPlayed = [];
    queue = { clips: clips, index: idx };
    return playSingle(clips[idx]);
  }

  // Starts (or restarts) an endless random loop within `filter` -- a new
  // random pick plays every time the previous one ends, until stopPlayback()
  // or a different clip is explicitly chosen.
  function playRandomLoop(filter) {
    queue = null;
    repeatClip = null;
    favoritesFilter = null;
    errorStreak = 0;
    recentlyPlayed = [];
    const clip = pickRandom(filter);
    if (!clip) { randomFilter = null; return null; }
    randomFilter = filter || {};
    return playSingle(clip);
  }

  function stopPlayback() {
    queue = null;
    randomFilter = null;
    repeatClip = null;
    favoritesFilter = null;
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    currentAudio = null;
    currentClipId = null;
    errorStreak = 0;
    recentlyPlayed = [];
    notifyChange();
  }

  // Play/pause toggle for a specific clip row: resumes in place if it's the
  // currently-loaded clip, starts fresh (stopping whatever else is playing,
  // no queue/loop) otherwise.
  function togglePlay(clip) {
    if (currentClipId === clip.id && currentAudio) {
      if (currentAudio.paused) { currentAudio.play().catch(function () {}); }
      else { currentAudio.pause(); }
      return currentAudio;
    }
    return playClip(clip);
  }

  // One-time-in-effect migration: normalizes any legacy mixed-case mentality
  // (from before uploads started lowercasing it) to lowercase. Without this,
  // e.g. "Goggins" and "goggins" clips form two separate subcat tiles
  // (renderSubcats groups by exact-match c.mentality) and the mixed-case one
  // silently falls through to default clip-art (also an exact-match lookup
  // against an all-lowercase manifest). Idempotent.
  function migrateMentalityCasing() {
    const clips = listClips();
    let changed = false;
    clips.forEach(function (c) {
      if (typeof c.mentality === 'string') {
        const normalized = c.mentality.trim().toLowerCase();
        if (normalized !== c.mentality) { c.mentality = normalized; changed = true; }
      }
    });
    if (changed) saveClips(clips);
  }

  // One-time-in-effect migration: clips tagged pillar:'iron' whose mentality
  // names Goggins move to their own 'mindset' pillar (Carl's 2026-07-20 call
  // to split Goggins out of Iron into its own section). Idempotent — safe to
  // call on every load, a no-op once a clip has already moved.
  function migrateGogginsToMindset() {
    const clips = listClips();
    let changed = false;
    clips.forEach(function (c) {
      if (c.pillar === 'iron' && typeof c.mentality === 'string' && c.mentality.toLowerCase().indexOf('goggins') !== -1) {
        c.pillar = 'mindset';
        changed = true;
      }
    });
    if (changed) saveClips(clips);
  }

  // Same pattern: clips tagged pillar:'iron' whose mentality names Carl
  // himself move to their own 'carl' pillar (2026-07-20, Carl's call to give
  // his own rants a dedicated section distinct from Dorian/hardcore Iron
  // content). Idempotent.
  function migrateCarlToOwnPillar() {
    const clips = listClips();
    let changed = false;
    clips.forEach(function (c) {
      if (c.pillar === 'iron' && typeof c.mentality === 'string' && c.mentality.toLowerCase().indexOf('carl') !== -1) {
        c.pillar = 'carl';
        changed = true;
      }
    });
    if (changed) saveClips(clips);
  }

  // Anonymous client-side Storage inserts are blocked by RLS (found live
  // 2026-08-17 -- both upload forms and record-your-own's Save always
  // returned null, silently). Uploads now route through /api/upload-clip,
  // a server endpoint gated by a shared passphrase (this app has exactly
  // one user and no login system -- see that file's own comment for why a
  // full Supabase Auth flow would be overkill here).
  var UPLOAD_SECRET_KEY = 'hype_audio_upload_secret';

  function getUploadSecret() {
    var stored = null;
    try { stored = localStorage.getItem(UPLOAD_SECRET_KEY); } catch (e) {}
    if (stored) return stored;
    var entered = window.prompt('Upload passphrase:');
    if (!entered) return null;
    try { localStorage.setItem(UPLOAD_SECRET_KEY, entered); } catch (e) {}
    return entered;
  }

  function clearUploadSecret() {
    try { localStorage.removeItem(UPLOAD_SECRET_KEY); } catch (e) {}
  }

  // Sanity ceiling only -- the file no longer passes through the Vercel
  // function (whose 4.5MB body limit is what silently broke every upload
  // over ~3.3MB under the old base64 flow), so this just catches "picked a
  // video by accident", not a transport constraint.
  var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

  // Returns { url, error }. Two steps: /api/upload-clip validates the
  // passphrase and returns a one-time signed Storage upload URL, then the
  // raw file PUTs directly to Storage -- no base64, no Vercel body limit.
  async function uploadClipFile(file) {
    var secret = getUploadSecret();
    if (!secret) return { url: null, error: 'Upload cancelled — no passphrase entered.' };
    // Neither the signed-URL flow nor the Storage bucket's file_size_limit
    // enforce a lower bound (that constraint is a maximum only) -- an empty
    // file would otherwise sail through and persist as a clip with a
    // permanently-broken 0-byte storage_url.
    if (file.size === 0) return { url: null, error: 'That file is empty.' };
    if (file.size > MAX_UPLOAD_BYTES) return { url: null, error: 'File too big — max 25MB for an audio clip.' };

    var res;
    try {
      res = await fetch('/api/upload-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-upload-secret': secret },
        body: JSON.stringify({ filename: file.name, contentType: file.type || 'audio/webm' }),
      });
    } catch (e) {
      return { url: null, error: 'Network error during upload.' };
    }

    var body = {};
    try { body = await res.json(); } catch (e) {}

    if (!res.ok) {
      if (res.status === 401) clearUploadSecret();
      return { url: null, error: body.error || ('Upload failed (' + res.status + ').') };
    }

    var putRes;
    try {
      putRes = await fetch(body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'audio/webm' },
        body: file,
      });
    } catch (e) {
      return { url: null, error: 'Network error during upload.' };
    }
    if (!putRes.ok) return { url: null, error: 'Storage upload failed (' + putRes.status + ').' };
    return { url: body.publicUrl, error: null };
  }

  if (typeof window !== 'undefined') {
    window.HypeAudio = {
      listClips: listClips,
      listActiveClips: listActiveClips,
      addClip: addClip,
      updateClip: updateClip,
      deleteClip: deleteClip,
      pickRandom: pickRandom,
      searchClips: searchClips,
      quotePreview: quotePreview,
      pickMidSetClip: pickMidSetClip,
      AUTO_PLAY_HYPE: AUTO_PLAY_HYPE,
      playMidSetHype: playMidSetHype,
      playPrRant: playPrRant,
      playClip: playClip,
      playFromList: playFromList,
      playRandomLoop: playRandomLoop,
      playRepeat: playRepeat,
      stopPlayback: stopPlayback,
      togglePlay: togglePlay,
      isPlaying: isPlaying,
      isCurrent: isCurrent,
      getCurrentClip: getCurrentClip,
      isPlayingRandom: isPlayingRandom,
      isPlayingMoment: isPlayingMoment,
      isPlayingRandomFilter: isPlayingRandomFilter,
      isPlayingRepeat: isPlayingRepeat,
      pickFavoriteWeighted: pickFavoriteWeighted,
      playFavoritesWeightedLoop: playFavoritesWeightedLoop,
      isPlayingFavoritesWeighted: isPlayingFavoritesWeighted,
      mediaSessionNext: mediaSessionNext,
      mediaSessionPrevious: mediaSessionPrevious,
      setArtworkResolver: setArtworkResolver,
      onPlaybackChange: onPlaybackChange,
      uploadClipFile: uploadClipFile,
      migrateMentalityCasing: migrateMentalityCasing,
      migrateGogginsToMindset: migrateGogginsToMindset,
      migrateCarlToOwnPillar: migrateCarlToOwnPillar,
      isOnCooldown: isOnCooldown,
      toggleDislikeCooldown: toggleDislikeCooldown,
    };
    setupMediaSessionHandlers();
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      listClips: listClips,
      listActiveClips: listActiveClips,
      addClip: addClip,
      updateClip: updateClip,
      deleteClip: deleteClip,
      pickRandom: pickRandom,
      searchClips: searchClips,
      quotePreview: quotePreview,
      pickMidSetClip: pickMidSetClip,
      AUTO_PLAY_HYPE: AUTO_PLAY_HYPE,
      playMidSetHype: playMidSetHype,
      playPrRant: playPrRant,
      mediaSessionNext: mediaSessionNext,
      mediaSessionPrevious: mediaSessionPrevious,
      getCurrentClip: getCurrentClip,
      playClip: playClip,
      playRepeat: playRepeat,
      playFromList: playFromList,
      playRandomLoop: playRandomLoop,
      stopPlayback: stopPlayback,
      isPlayingMoment: isPlayingMoment,
      isPlayingRandomFilter: isPlayingRandomFilter,
      pickFavoriteWeighted: pickFavoriteWeighted,
      playFavoritesWeightedLoop: playFavoritesWeightedLoop,
      isPlayingFavoritesWeighted: isPlayingFavoritesWeighted,
      migrateMentalityCasing: migrateMentalityCasing,
      migrateGogginsToMindset: migrateGogginsToMindset,
      migrateCarlToOwnPillar: migrateCarlToOwnPillar,
      isOnCooldown: isOnCooldown,
      toggleDislikeCooldown: toggleDislikeCooldown,
      uploadClipFile: uploadClipFile,
    };
  }
})();

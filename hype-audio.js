// Hype Audio — shared core logic (metadata list + Storage upload).
// Copied verbatim into both the Row repo and the standalone hype-audio
// repo, same duplication pattern sync.js/topbar.js already use across
// Row/Vessel's separate static-site repos. No build step, no bundler.
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
    clips.push(meta);
    saveClips(clips);
  }

  function updateClip(id, patch) {
    const clips = listClips();
    const idx = clips.findIndex((c) => c.id === id);
    if (idx === -1) return;
    clips[idx] = Object.assign({}, clips[idx], patch);
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
    clips[idx] = Object.assign({}, clips[idx], { deleted: true, deleted_at: Date.now() });
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
    return pool[Math.floor(Math.random() * pool.length)];
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
  let onChangeCb = null;
  // Auto-advance state: at most one of these is active at a time. `queue` is
  // a fixed snapshot (list + position) for "play down the list from here";
  // `randomFilter` re-picks a new random clip matching the filter every time
  // one ends, looping until stopped. Starting either cancels the other.
  let queue = null;
  let randomFilter = null;
  let repeatClip = null;

  function notifyChange() { if (onChangeCb) onChangeCb(); }

  // Subscribe to play/pause/end state changes so the UI can re-render the
  // right row's play/pause icon without polling.
  function onPlaybackChange(cb) { onChangeCb = cb; }

  function isPlaying(clipId) {
    return currentClipId === clipId && !!currentAudio && !currentAudio.paused;
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

  function isPlayingRepeat(clipId) { return !!repeatClip && repeatClip.id === clipId; }

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
    audio.onplay = function () {
      updateClip(clip.id, { play_count: (clip.play_count || 0) + 1 });
      notifyChange();
    };
    audio.onpause = notifyChange;
    audio.onended = function () { currentClipId = null; advance(); };
    audio.onerror = function () {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        alert('This clip isn\'t downloaded yet -- needs a connection to play for the first time.');
      }
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
    }
    notifyChange();
  }

  function playClip(clip) {
    queue = null;
    randomFilter = null;
    repeatClip = null;
    return playSingle(clip);
  }

  // Repeats one clip over and over until stopPlayback() or a different
  // clip/mode is chosen.
  function playRepeat(clip) {
    queue = null;
    randomFilter = null;
    repeatClip = clip;
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
    queue = { clips: clips, index: idx };
    return playSingle(clips[idx]);
  }

  // Starts (or restarts) an endless random loop within `filter` -- a new
  // random pick plays every time the previous one ends, until stopPlayback()
  // or a different clip is explicitly chosen.
  function playRandomLoop(filter) {
    queue = null;
    repeatClip = null;
    const clip = pickRandom(filter);
    if (!clip) { randomFilter = null; return null; }
    randomFilter = filter || {};
    return playSingle(clip);
  }

  function stopPlayback() {
    queue = null;
    randomFilter = null;
    repeatClip = null;
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    currentAudio = null;
    currentClipId = null;
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

  async function uploadClipFile(file, supa) {
    const filename = 'clip_' + Date.now() + '_' +
      Math.random().toString(36).slice(2, 10) + '_' + file.name;
    const { error } = await supa.storage
      .from('hype-audio')
      .upload(filename, file, { contentType: file.type, upsert: false });
    if (error) return null;
    const { data } = supa.storage.from('hype-audio').getPublicUrl(filename);
    return data ? data.publicUrl : null;
  }

  if (typeof window !== 'undefined') {
    window.HypeAudio = {
      listClips: listClips,
      listActiveClips: listActiveClips,
      addClip: addClip,
      updateClip: updateClip,
      deleteClip: deleteClip,
      pickRandom: pickRandom,
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
      isPlayingRandom: isPlayingRandom,
      isPlayingMoment: isPlayingMoment,
      isPlayingRandomFilter: isPlayingRandomFilter,
      isPlayingRepeat: isPlayingRepeat,
      mediaSessionNext: mediaSessionNext,
      mediaSessionPrevious: mediaSessionPrevious,
      setArtworkResolver: setArtworkResolver,
      onPlaybackChange: onPlaybackChange,
      uploadClipFile: uploadClipFile,
      migrateGogginsToMindset: migrateGogginsToMindset,
      migrateCarlToOwnPillar: migrateCarlToOwnPillar,
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
      pickMidSetClip: pickMidSetClip,
      AUTO_PLAY_HYPE: AUTO_PLAY_HYPE,
      playMidSetHype: playMidSetHype,
      playPrRant: playPrRant,
      mediaSessionNext: mediaSessionNext,
      mediaSessionPrevious: mediaSessionPrevious,
      playRandomLoop: playRandomLoop,
      stopPlayback: stopPlayback,
      isPlayingMoment: isPlayingMoment,
      isPlayingRandomFilter: isPlayingRandomFilter,
      migrateGogginsToMindset: migrateGogginsToMindset,
      migrateCarlToOwnPillar: migrateCarlToOwnPillar,
    };
  }
})();

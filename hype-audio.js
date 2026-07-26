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

  // Internal: plays exactly one clip and wires its natural end to advance()
  // -- the only thing that knows about queue/randomFilter. A user pause
  // never advances (onpause isn't wired to it), only a clip actually ending.
  function playSingle(clip) {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    const audio = new Audio(clip.storage_url);
    currentAudio = audio;
    currentClipId = clip.id;
    audio.onplay = notifyChange;
    audio.onpause = notifyChange;
    audio.onended = function () { currentClipId = null; advance(); };
    audio.play().catch(function () {});
    updateClip(clip.id, { play_count: (clip.play_count || 0) + 1 });
    notifyChange();
    return audio;
  }

  function advance() {
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
    return playSingle(clip);
  }

  // Plays clipId and continues sequentially through the rest of `clips`
  // (the exact array passed in, e.g. the currently-rendered/filtered list)
  // until it reaches the end or gets interrupted.
  function playFromList(clips, clipId) {
    const idx = clips.findIndex(function (c) { return c.id === clipId; });
    if (idx === -1) return null;
    randomFilter = null;
    queue = { clips: clips, index: idx };
    return playSingle(clips[idx]);
  }

  // Starts (or restarts) an endless random loop within `filter` -- a new
  // random pick plays every time the previous one ends, until stopPlayback()
  // or a different clip is explicitly chosen.
  function playRandomLoop(filter) {
    queue = null;
    const clip = pickRandom(filter);
    if (!clip) { randomFilter = null; return null; }
    randomFilter = filter || {};
    return playSingle(clip);
  }

  function stopPlayback() {
    queue = null;
    randomFilter = null;
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
      playClip: playClip,
      playFromList: playFromList,
      playRandomLoop: playRandomLoop,
      stopPlayback: stopPlayback,
      togglePlay: togglePlay,
      isPlaying: isPlaying,
      isCurrent: isCurrent,
      isPlayingRandom: isPlayingRandom,
      onPlaybackChange: onPlaybackChange,
      uploadClipFile: uploadClipFile,
      migrateGogginsToMindset: migrateGogginsToMindset,
      migrateCarlToOwnPillar: migrateCarlToOwnPillar,
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      listClips: listClips,
      listActiveClips: listActiveClips,
      addClip: addClip,
      updateClip: updateClip,
      deleteClip: deleteClip,
      pickRandom: pickRandom,
      migrateGogginsToMindset: migrateGogginsToMindset,
      migrateCarlToOwnPillar: migrateCarlToOwnPillar,
    };
  }
})();

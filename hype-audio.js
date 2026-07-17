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

  function deleteClip(id) {
    saveClips(listClips().filter((c) => c.id !== id));
  }

  function pickRandom(filter) {
    filter = filter || {};
    const pool = listClips().filter((c) =>
      (!filter.mentality || c.mentality === filter.mentality) &&
      (!filter.moment || c.moment === filter.moment) &&
      (!filter.pillar || c.pillar === filter.pillar)
    );
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function playClip(clip) {
    const audio = new Audio(clip.storage_url);
    audio.play().catch(function () {});
    updateClip(clip.id, { play_count: (clip.play_count || 0) + 1 });
    return audio;
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

  window.HypeAudio = {
    listClips: listClips,
    addClip: addClip,
    updateClip: updateClip,
    deleteClip: deleteClip,
    pickRandom: pickRandom,
    playClip: playClip,
    uploadClipFile: uploadClipFile,
  };
})();

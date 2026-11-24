// Run with: node hype-side-transcripts.selfcheck.js
// 420 clips have no transcript_text in the synced row; their Whisper text lives in ONE side row, app_state key 'hype-audio:transcripts',
// keyed by the clip's file name. Search, the quote preview and the content-ideas gate read a clip's transcript through transcriptOf().
'use strict';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.Audio = function (src) { this.src = src; this.paused = true; };
global.Audio.prototype.play = function () { this.paused = false; return Promise.resolve(); };
global.Audio.prototype.pause = function () { this.paused = true; };

const HypeAudio = require('./hype-audio.js');
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.exit(1); }
}
const url = (f) => 'https://x.supabase.co/storage/v1/object/public/hype-audio/' + f;
const base = { play_count: 0, moment: 'pre_workout', mentality: 'goggins' };
HypeAudio.addClip({ ...base, id: 'a', title: 'Rant A', pillar: 'carl', storage_url: url('clip_a.mp3') });                          // side text only
HypeAudio.addClip({ ...base, id: 'b', title: 'Rant B', pillar: 'carl', storage_url: url('clip_b.mp3'), transcript_text: 'in the row' }); // in-row text wins
HypeAudio.addClip({ ...base, id: 'c', title: 'Iron C', pillar: 'iron', storage_url: url('clip_c.mp3') });                          // not a carl clip
HypeAudio.addClip({ ...base, id: 'd', title: 'Rant D', pillar: 'carl', storage_url: url('clip_d.mp3') });                          // Whisper heard no speech
HypeAudio.addClip({ ...base, id: 'e', title: 'Rant E', pillar: 'carl', storage_url: url('clip_e.mp3'), content_idea_sent: true });  // already sent

const SIDE = {
  'clip_a.mp3': { t: 'Discipline is what you do when nobody is watching', d: 20, l: -14, n: 0.01 },
  'clip_b.mp3': { t: 'side text must NOT win', d: 20, l: -14, n: 0.01 },
  'clip_c.mp3': { t: 'Squat depth is a choice', d: 20, l: -14, n: 0.01 },
  'clip_d.mp3': { t: 'thanks for watching', d: 20, l: -30, n: 0.9 },
  'clip_e.mp3': { t: 'already sent text', d: 20, l: -14, n: 0.01 },
};
const clip = (id) => HypeAudio.listClips().find((c) => c.id === id);
const ids = (r) => r.map((c) => c.id).sort();

(async () => {
  // before the side row is loaded: nothing changes
  assertEqual(ids(HypeAudio.searchClips('discipline')), [], 'a side-only transcript is not searchable before the side row loads');
  assertEqual(HypeAudio.transcriptOf(clip('a')), '', 'no transcript before load');
  assertEqual(HypeAudio.hasPendingContentIdea(clip('a')), false, 'not pending without a transcript');

  // no client at all (signed out, or an older page): resolves false, never throws, stays unloaded
  assertEqual(await HypeAudio.ensureSideTranscripts(), false, 'no HypeAuth: resolves false');

  // a failed read changes nothing and is retried on the next call
  let calls = 0; let mode = 'error';
  global.window = { HypeAuth: { getClient: () => ({ from: (t) => ({ select: () => ({ eq: (col, key) => ({ abortSignal() { return this; }, maybeSingle: async () => {
    calls++;
    if (t !== 'app_state' || key !== 'hype-audio:transcripts') throw new Error('wrong table or key: ' + t + ' ' + key);
    return mode === 'error' ? { data: null, error: { code: '42501' } } : { data: { data: SIDE }, error: null };
  } }) }) }) }) } };
  // search asks on every keystroke, so a failure backs off for 30 s; the clock is shimmed to step past it
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  skew += 31000; // past the backoff left by the no-client call above
  assertEqual(await HypeAudio.ensureSideTranscripts(), false, 'a refused read resolves false');
  assertEqual(HypeAudio.sideTranscriptsLoaded(), false, 'still unloaded after a refusal');
  const refusedCalls = calls;
  mode = 'ok';
  assertEqual(await HypeAudio.ensureSideTranscripts(), false, 'right after a failure it does not ask again');
  assertEqual(calls, refusedCalls, 'and makes no read');
  skew += 31000;
  assertEqual(await HypeAudio.ensureSideTranscripts(), true, 'after the backoff the retry works');
  assertEqual(HypeAudio.sideTranscriptsLoaded(), true, 'loaded');
  const afterLoad = calls;
  await HypeAudio.ensureSideTranscripts();
  assertEqual(calls, afterLoad, 'loaded once: a second call does not read again');

  // after the load
  assertEqual(ids(HypeAudio.searchClips('discipline')), ['a'], 'search finds a clip by its side transcript');
  assertEqual(ids(HypeAudio.searchClips('SQUAT')), ['c'], 'case-insensitive');
  assertEqual(ids(HypeAudio.searchClips('in the row')), ['b'], 'in-row transcripts still searchable');
  assertEqual(ids(HypeAudio.searchClips('side text must not')), [], 'the in-row transcript wins over the side one');
  assertEqual(HypeAudio.transcriptOf(clip('b')), 'in the row', 'transcriptOf prefers the row');
  assertEqual(HypeAudio.quotePreview(clip('a'), 20), 'Discipline is what…', 'the preview line uses the side transcript');
  assertEqual(HypeAudio.transcriptOf(clip('d')), '', 'text Whisper flagged as no speech is not used');
  assertEqual(ids(HypeAudio.searchClips('thanks for watching')), [], 'and is not searchable');
  assertEqual(HypeAudio.hasPendingContentIdea(clip('a')), true, 'a carl clip with a side transcript is pending for content ideas');
  assertEqual(HypeAudio.hasPendingContentIdea(clip('c')), false, 'a non-carl clip is not');
  assertEqual(HypeAudio.hasPendingContentIdea(clip('d')), false, 'a no-speech clip is not');
  assertEqual(HypeAudio.hasPendingContentIdea(clip('e')), false, 'an already-sent clip is not');

  console.log('hype-side-transcripts: all assertions passed');
})();

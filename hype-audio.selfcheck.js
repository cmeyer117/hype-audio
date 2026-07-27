// Run with: node hype-audio.selfcheck.js
'use strict';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

// Minimal Audio shim -- playRandomLoop/stopPlayback (needed to test
// isPlayingMoment's randomFilter state) go through playSingle(), which does
// `new Audio(clip.storage_url)`. Node has no Audio global.
global.Audio = function (src) {
  this.src = src;
  this.paused = true;
};
global.Audio.prototype.play = function () { this.paused = false; return Promise.resolve(); };
global.Audio.prototype.pause = function () { this.paused = true; };

const HypeAudio = require('./hype-audio.js');

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.exit(1); }
}

// addClip + listClips
HypeAudio.addClip({ id: '1', title: 'A', mentality: 'goggins', moment: 'pre_workout', play_count: 0 });
HypeAudio.addClip({ id: '2', title: 'B', mentality: 'dorian', moment: 'mid_set', play_count: 0 });
assertEqual(HypeAudio.listClips().length, 2, 'addClip adds to the list');

// updateClip
HypeAudio.updateClip('1', { play_count: 5 });
assertEqual(HypeAudio.listClips().find((c) => c.id === '1').play_count, 5, 'updateClip patches the right clip');

// pickRandom with mentality filter
assertEqual(HypeAudio.pickRandom({ mentality: 'dorian' }).id, '2', 'pickRandom respects a mentality filter');
assertEqual(HypeAudio.pickRandom({ mentality: 'nonexistent' }), null, 'pickRandom returns null when nothing matches');

// pickRandom with pillar filter — clips 1/2 have no pillar (unmigrated legacy shape)
HypeAudio.addClip({ id: '3', title: 'C', mentality: 'worship', pillar: 'faith', play_count: 0 });
assertEqual(HypeAudio.pickRandom({ pillar: 'iron' }), null, 'pickRandom with pillar:iron finds nothing among unmigrated/faith clips');
assertEqual(HypeAudio.pickRandom({ pillar: 'faith' }).id, '3', 'pickRandom respects a pillar filter');

// deleteClip is a soft-delete (tombstone) — the whole reason is so a cloud-sync
// merge from another device/tab can't silently un-delete a clip (mergeArrays
// in sync.js can't tell "never synced" from "deleted" once an entry is just gone).
HypeAudio.deleteClip('3');
assertEqual(HypeAudio.listActiveClips().map((c) => c.id), ['1', '2'], 'deleted clip drops out of listActiveClips');
assertEqual(HypeAudio.listClips().map((c) => c.id), ['1', '2', '3'], 'deleted clip stays in listClips as a tombstone, not removed');
assertEqual(HypeAudio.listClips().find((c) => c.id === '3').deleted, true, 'tombstone is marked deleted:true');
assertEqual(HypeAudio.pickRandom({}).id === '3', false, 'pickRandom never returns a deleted clip');

// migrateGogginsToMindset — splits Goggins-mentality iron clips into their own pillar
HypeAudio.addClip({ id: '4', title: 'D', mentality: 'David Goggins', pillar: 'iron', play_count: 0 });
HypeAudio.addClip({ id: '5', title: 'E', mentality: 'dorian', pillar: 'iron', play_count: 0 });
HypeAudio.migrateGogginsToMindset();
assertEqual(HypeAudio.listClips().find((c) => c.id === '4').pillar, 'mindset', 'goggins-mentality iron clip migrates to mindset');
assertEqual(HypeAudio.listClips().find((c) => c.id === '5').pillar, 'iron', 'non-goggins iron clip stays iron');
HypeAudio.migrateGogginsToMindset();
assertEqual(HypeAudio.listClips().find((c) => c.id === '4').pillar, 'mindset', 'migration is idempotent');

// pickRandom accepts an array of pillars (Row's widget pulls iron+mindset together)
const multiPick = HypeAudio.pickRandom({ pillar: ['iron', 'mindset'] });
assertEqual(['4', '5'].indexOf(multiPick.id) !== -1, true, 'pickRandom with a pillar array matches any listed pillar');
assertEqual(HypeAudio.pickRandom({ pillar: ['dorian-nonexistent'] }), null, 'pickRandom with a pillar array excludes non-matching pillars');

// migrateCarlToOwnPillar — splits Carl's-own-voice iron clips into their own pillar
HypeAudio.addClip({ id: '6', title: 'F', mentality: 'carl rant', pillar: 'iron', play_count: 0 });
HypeAudio.migrateCarlToOwnPillar();
assertEqual(HypeAudio.listClips().find((c) => c.id === '6').pillar, 'carl', 'carl-mentality iron clip migrates to its own carl pillar');
assertEqual(HypeAudio.listClips().find((c) => c.id === '5').pillar, 'iron', 'non-carl, non-goggins iron clip stays iron');
HypeAudio.migrateCarlToOwnPillar();
assertEqual(HypeAudio.listClips().find((c) => c.id === '6').pillar, 'carl', 'migration is idempotent');

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

// isPlayingMoment -- distinguishes "random-looping this moment" (home-screen
// PRE/MID-SET/POST buttons) from "a pillar's own PLAY RANDOM", both of
// which share the same randomFilter state.
HypeAudio.addClip({ id: '7', title: 'G', mentality: 'worship', pillar: 'faith', moment: 'pre_workout', play_count: 0 });
HypeAudio.playRandomLoop({ moment: 'pre_workout' });
assertEqual(HypeAudio.isPlayingMoment('pre_workout'), true, 'isPlayingMoment is true for the moment currently looping');
assertEqual(HypeAudio.isPlayingMoment('mid_set'), false, 'isPlayingMoment is false for a different moment');

HypeAudio.playRandomLoop({ pillar: 'faith' });
assertEqual(HypeAudio.isPlayingMoment('pre_workout'), false, 'isPlayingMoment is false when the active random loop is pillar-scoped, not moment-scoped, even if a matching clip happens to have that moment');

HypeAudio.stopPlayback();
assertEqual(HypeAudio.isPlayingMoment('pre_workout'), false, 'isPlayingMoment is false once playback is stopped');

// isPlayingRandomFilter -- exact-match check so a pillar's own PLAY RANDOM
// button doesn't show active just because *some* random loop (e.g. a
// moment-mode one) happens to be running. Bug found live: a Faith pillar's
// "PLAY RANDOM" button showed "STOP" while a moment-mode loop was playing,
// because the old check (isPlayingRandom(), just !!randomFilter) can't tell
// "this pillar's own loop" from "any random loop at all."
HypeAudio.playRandomLoop({ moment: 'pre_workout' });
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'faith' }), false, 'a pillar random-play button is not active while a moment-mode loop (not that pillar\'s own) is playing');
HypeAudio.playRandomLoop({ pillar: 'faith' });
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'faith' }), true, 'a pillar random-play button is active when that exact pillar-scoped loop is playing');
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'faith', mentality: 'worship' }), false, 'a mentality-scoped random-play button is not active when only the pillar-wide (no mentality) loop is playing');
HypeAudio.playRandomLoop({ pillar: 'faith', mentality: 'worship' });
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'faith', mentality: 'worship' }), true, 'a mentality-scoped random-play button is active for its exact filter');
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'faith' }), false, 'a pillar-wide random-play button is not active while a more specific mentality-scoped loop within it is playing');
HypeAudio.stopPlayback();
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'faith' }), false, 'isPlayingRandomFilter is false once playback is stopped');

// searchClips -- case-insensitive substring across title + transcript_text
HypeAudio.addClip({ id: 'search1', title: 'Discipline Equals Freedom', mentality: 'goggins', play_count: 0 });
HypeAudio.addClip({ id: 'search2', title: 'Untitled', mentality: 'dorian', transcript_text: 'Stay hard no matter what happens', play_count: 0 });
assertEqual(HypeAudio.searchClips('freedom').map(c => c.id), ['search1'], 'searchClips matches on title, case-insensitive');
assertEqual(HypeAudio.searchClips('STAY HARD').map(c => c.id), ['search2'], 'searchClips matches on transcript_text, case-insensitive');
assertEqual(HypeAudio.searchClips('nonexistent phrase'), [], 'searchClips returns [] when nothing matches');
assertEqual(HypeAudio.searchClips(''), [], 'searchClips returns [] for an empty query');
HypeAudio.addClip({ id: 'search3', title: null, mentality: 'dorian', transcript_text: 123, play_count: 0 });
assertEqual(HypeAudio.searchClips('anything').map(c => c.id).indexOf('search3'), -1, 'searchClips ignores clips with non-string title/transcript_text instead of throwing');

// quotePreview -- truncation + graceful absence
const longClip = { transcript_text: 'a'.repeat(100) };
assertEqual(HypeAudio.quotePreview(longClip, 10).length, 11, 'quotePreview truncates to maxLen + ellipsis char');
assertEqual(HypeAudio.quotePreview({ transcript_text: 'short' }, 80), 'short', 'quotePreview returns full text when under maxLen');
assertEqual(HypeAudio.quotePreview({}, 80), null, 'quotePreview returns null with no transcript_text');
assertEqual(HypeAudio.quotePreview({ transcript_text: 'hello world' }, 0), '…', 'quotePreview with maxLen:0 truncates immediately rather than using the 80-char default');

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

// playFavoritesWeightedLoop / isPlayingFavoritesWeighted / stopPlayback --
// playSingle() (and every play* function that goes through it, including
// the pre-existing playRandomLoop) returns the Audio object, not the clip,
// so only truthiness is meaningful here -- production code already only
// checks that ("if (!clip) alert(...)"), never reads .id off the return.
const favPlayResult = HypeAudio.playFavoritesWeightedLoop({ pillar: 'iron', mentality: 'goggins' });
assertEqual(!!favPlayResult, true, 'playFavoritesWeightedLoop returns a truthy result when the pool has a match');
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
const favNextResult = HypeAudio.mediaSessionNext(null, null, null, { pillar: 'iron', mentality: 'goggins' });
assertEqual(favNextResult.type, 'clip', 'mediaSessionNext picks a clip when favoritesFilterState is active');
const favPrevResult = HypeAudio.mediaSessionPrevious(null, null, null, 0, { pillar: 'iron', mentality: 'goggins' });
assertEqual(favPrevResult.type, 'none', 'mediaSessionPrevious is a no-op during a favorites loop, same as randomFilter');

console.log('hype-audio.selfcheck.js: all assertions passed');

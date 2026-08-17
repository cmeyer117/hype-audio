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

// getCurrentClip -- what the now-playing bar renders from
const npClip = HypeAudio.listActiveClips().find(c => c.id === 'fav1');
HypeAudio.playClip(npClip);
assertEqual(HypeAudio.getCurrentClip().id, 'fav1', 'getCurrentClip returns the loaded clip while playing');
HypeAudio.stopPlayback();
assertEqual(HypeAudio.getCurrentClip(), null, 'getCurrentClip is null after stopPlayback');

// play_count -- counts once per playback (a resume re-fires onplay but is
// the same listen), and accumulates across repeat-mode restarts (the old
// code re-read a stale clip snapshot, so repeats never accumulated).
const countClipBefore = HypeAudio.listClips().find(c => c.id === 'fav1').play_count || 0;
const countAudio = HypeAudio.playClip(npClip);
countAudio.onplay();
countAudio.onplay(); // simulated resume after pause
assertEqual(HypeAudio.listClips().find(c => c.id === 'fav1').play_count, countClipBefore + 1, 'play_count increments once per Audio element, resume does not re-count');
const repeatAudio = HypeAudio.playRepeat(npClip);
repeatAudio.onplay();
assertEqual(HypeAudio.listClips().find(c => c.id === 'fav1').play_count, countClipBefore + 2, 'play_count accumulates across plays via a fresh read, not the stale clip snapshot');
HypeAudio.stopPlayback();

// onerror skip-ahead -- a broken storage_url used to silently kill the
// queue/loop (onended never fires, nothing advances).
const errClips = [
  HypeAudio.listClips().find(c => c.id === 'fav1'),
  HypeAudio.listClips().find(c => c.id === 'fav2'),
];
const errAudio = HypeAudio.playFromList(errClips, 'fav1');
errAudio.onerror();
assertEqual(HypeAudio.getCurrentClip().id, 'fav2', 'a playback error advances to the next clip instead of killing the queue');
errAudio.onerror(); // stale handler on the replaced Audio must be inert
assertEqual(HypeAudio.getCurrentClip().id, 'fav2', 'a stale Audio\'s late onerror does not advance again');
HypeAudio.stopPlayback();

// errorStreak resets per playback session -- a streak left over from an
// earlier failed session must not stop a brand-new one on its first error.
const pumpAudio = HypeAudio.playClip(errClips[0]);
pumpAudio.onerror(); pumpAudio.onerror(); pumpAudio.onerror(); pumpAudio.onerror(); // streak: 4
const freshAudio = HypeAudio.playFromList(errClips, 'fav1');
freshAudio.onerror(); // would hit the streak-5 stop without the per-session reset
assertEqual(HypeAudio.getCurrentClip() && HypeAudio.getCurrentClip().id, 'fav2', 'a new playback session resets the error streak instead of inheriting a stale one');
HypeAudio.stopPlayback();

// Offline error stops playback cleanly -- no "paused" now-playing state
// left pointing at a terminally-errored Audio.
// Node 24's globalThis.navigator is getter-only, so plain assignment throws.
Object.defineProperty(global, 'navigator', { value: { onLine: false }, configurable: true });
global.alert = function () {};
const offlineAudio = HypeAudio.playClip(errClips[0]);
offlineAudio.onerror();
assertEqual(HypeAudio.getCurrentClip(), null, 'an offline playback error stops playback instead of leaving a dead resumable state');
delete global.navigator;
delete global.alert;

// getCurrentClip does a fresh lookup, not a held reference -- self-heals a
// title edited mid-playback instead of serving a stale snapshot.
const freshTestAudio = HypeAudio.playClip(HypeAudio.listActiveClips().find(c => c.id === 'fav1'));
HypeAudio.updateClip('fav1', { title: 'Edited Mid-Playback' });
assertEqual(HypeAudio.getCurrentClip().title, 'Edited Mid-Playback', 'getCurrentClip reflects a metadata edit made while the clip is still playing, not a stale snapshot');
HypeAudio.stopPlayback();

// onplay staleness guard -- pause() called before a play() promise settles
// doesn't retract the already-queued 'play' event in real browsers, so a
// skipped clip's onplay can still fire after a newer clip has taken over.
// It must be a no-op then, same as onended/onerror already guard.
const staleA = HypeAudio.playClip(HypeAudio.listActiveClips().find(c => c.id === 'fav1'));
const countBeforeStaleFire = HypeAudio.listClips().find(c => c.id === 'fav1').play_count || 0;
const staleB = HypeAudio.playClip(HypeAudio.listActiveClips().find(c => c.id === 'fav2'));
staleA.onplay(); // A's Audio element is stale now that B has taken over
assertEqual(HypeAudio.listClips().find(c => c.id === 'fav1').play_count, countBeforeStaleFire, 'a stale Audio\'s late onplay does not record a phantom play_count for the clip the user already skipped past');
assertEqual(HypeAudio.getCurrentClip().id, 'fav2', 'a stale Audio\'s late onplay does not disturb which clip is actually current');
HypeAudio.stopPlayback();

// migrateMentalityCasing -- normalizes legacy mixed-case mentality so it
// doesn't form a second, separate subcat tile from lowercase new uploads.
HypeAudio.addClip({ id: 'casing1', title: 'Mixed Case', mentality: 'Goggins Legacy', pillar: 'iron', play_count: 0 });
HypeAudio.migrateMentalityCasing();
assertEqual(HypeAudio.listClips().find(c => c.id === 'casing1').mentality, 'goggins legacy', 'migrateMentalityCasing lowercases a legacy mixed-case mentality');
HypeAudio.migrateMentalityCasing();
assertEqual(HypeAudio.listClips().find(c => c.id === 'casing1').mentality, 'goggins legacy', 'migration is idempotent');

// toggleDislikeCooldown / isOnCooldown -- an explicit "Not now" action that
// excludes a clip from random/favorites picks for 1 day, then it's
// automatically back in rotation.
HypeAudio.addClip({ id: 'shuffle1', title: 'Shuffle Test A', mentality: 'test', pillar: 'iron', play_count: 0 });
assertEqual(HypeAudio.isOnCooldown(HypeAudio.listClips().find(c => c.id === 'shuffle1')), false, 'a fresh clip is not on cooldown');
HypeAudio.toggleDislikeCooldown('shuffle1');
const cooledClip = HypeAudio.listClips().find(c => c.id === 'shuffle1');
assertEqual(HypeAudio.isOnCooldown(cooledClip), true, 'toggleDislikeCooldown puts the clip on cooldown');
assertEqual(cooledClip.disliked_until > Date.now(), true, 'disliked_until is set in the future');
assertEqual(cooledClip.disliked_until <= Date.now() + 24 * 60 * 60 * 1000, true, 'disliked_until is at most 1 day out');
HypeAudio.toggleDislikeCooldown('shuffle1');
assertEqual(HypeAudio.isOnCooldown(HypeAudio.listClips().find(c => c.id === 'shuffle1')), false, 'toggling again while on cooldown clears it');
HypeAudio.toggleDislikeCooldown('nonexistent-id'); // must not throw

// filterEligiblePool (via pickRandom) -- cooldown exclusion, with a
// fallback so an all-cooled-down pool still returns a pick.
HypeAudio.addClip({ id: 'shuffle2', title: 'Shuffle Test B', mentality: 'shuffletest', pillar: 'iron', play_count: 0 });
HypeAudio.addClip({ id: 'shuffle3', title: 'Shuffle Test C', mentality: 'shuffletest', pillar: 'iron', play_count: 0 });
HypeAudio.toggleDislikeCooldown('shuffle2');
for (let i = 0; i < 10; i++) {
  assertEqual(HypeAudio.pickRandom({ mentality: 'shuffletest' }).id, 'shuffle3', 'pickRandom excludes a clip on cooldown when an eligible one exists');
}
HypeAudio.toggleDislikeCooldown('shuffle3'); // now both shuffle2 and shuffle3 are on cooldown
const bothCooledPick = HypeAudio.pickRandom({ mentality: 'shuffletest' });
assertEqual(['shuffle2', 'shuffle3'].indexOf(bothCooledPick.id) !== -1, true, 'pickRandom still returns a pick when the whole pool is on cooldown (fallback engages)');
HypeAudio.toggleDislikeCooldown('shuffle2'); // clear both for the recency test below
HypeAudio.toggleDislikeCooldown('shuffle3');

// No-repeat window -- a clip just played is excluded from the next pick as
// long as an alternative exists in the same pool. The Node Audio shim
// doesn't auto-fire 'play' (see the shim near the top of this file), so
// onplay must be invoked manually -- same pattern the play_count tests
// above already use (e.g. `countAudio.onplay()`). recentlyPlayed is
// populated inside onplay, not by playClip() itself.
const shuffle2Audio = HypeAudio.playClip(HypeAudio.listClips().find(c => c.id === 'shuffle2'));
shuffle2Audio.onplay();
for (let i = 0; i < 10; i++) {
  assertEqual(HypeAudio.pickRandom({ mentality: 'shuffletest' }).id, 'shuffle3', 'pickRandom avoids repicking the clip that just played when an alternative exists');
}
HypeAudio.stopPlayback();

// Recency fallback -- a pool of exactly one clip still returns that clip
// even after it was "just played" (recency filter would otherwise empty it).
HypeAudio.addClip({ id: 'shuffle4', title: 'Shuffle Test D', mentality: 'shuffleonly', pillar: 'iron', play_count: 0 });
const shuffle4Audio = HypeAudio.playClip(HypeAudio.listClips().find(c => c.id === 'shuffle4'));
shuffle4Audio.onplay();
assertEqual(HypeAudio.pickRandom({ mentality: 'shuffleonly' }).id, 'shuffle4', 'pickRandom falls back to the just-played clip when it is the only one in the pool');
HypeAudio.stopPlayback();

// filterEligiblePool applies to pickFavoriteWeighted too -- the previous
// block only covered pickRandom.
HypeAudio.addClip({ id: 'shuffle5', title: 'Shuffle Test E', mentality: 'favshuffletest', pillar: 'iron', favorite: true, play_count: 0 });
HypeAudio.addClip({ id: 'shuffle6', title: 'Shuffle Test F', mentality: 'favshuffletest', pillar: 'iron', favorite: true, play_count: 0 });
HypeAudio.toggleDislikeCooldown('shuffle5');
for (let i = 0; i < 10; i++) {
  assertEqual(HypeAudio.pickFavoriteWeighted({ mentality: 'favshuffletest' }).id, 'shuffle6', 'pickFavoriteWeighted excludes a clip on cooldown when an eligible one exists');
}
HypeAudio.toggleDislikeCooldown('shuffle5'); // clear for cleanliness

// recentlyPlayed is scoped to "the current playback session," not global
// forever -- code review caught that without a reset in every mode-starter,
// clips played via one pool would suppress themselves from an unrelated
// pool's picks too. Play shuffle3 via one filter, then start a fresh
// session against a completely different pool and confirm nothing there
// is wrongly excluded.
HypeAudio.addClip({ id: 'shuffle7', title: 'Shuffle Test G', mentality: 'unrelatedpool', pillar: 'faith', play_count: 0 });
const bleedAudio = HypeAudio.playClip(HypeAudio.listClips().find(c => c.id === 'shuffle3'));
bleedAudio.onplay(); // shuffle3 now in recentlyPlayed
HypeAudio.playRandomLoop({ mentality: 'unrelatedpool' }); // a fresh mode-starter -- must reset recentlyPlayed
assertEqual(HypeAudio.pickRandom({ mentality: 'unrelatedpool' }).id, 'shuffle7', 'starting a new session against an unrelated pool is not contaminated by a different pool\'s recent plays');
HypeAudio.stopPlayback();

// STATE_MODES / pickRandom({ stateMode }) -- pillar+mentality PAIRS, not
// bare mentality strings, so a clip matching the mentality but the wrong
// pillar is correctly excluded.
HypeAudio.addClip({ id: 'mode1', title: 'Mode Test A', pillar: 'mindset', mentality: 'discipline', play_count: 0 });
HypeAudio.addClip({ id: 'mode2', title: 'Mode Test B', pillar: 'mindset', mentality: 'resilience', play_count: 0 });
HypeAudio.addClip({ id: 'mode3', title: 'Mode Test C', pillar: 'carl', mentality: 'discipline', play_count: 0 }); // same mentality, wrong pillar -- must NOT match need_discipline
for (let i = 0; i < 15; i++) {
  const picked = HypeAudio.pickRandom({ stateMode: 'need_discipline' }).id;
  assertEqual(['mode1', 'mode2'].indexOf(picked) !== -1, true, 'pickRandom({stateMode}) only returns clips matching one of the mode\'s exact pillar+mentality pairs');
}
assertEqual(HypeAudio.pickRandom({ stateMode: 'not_a_real_mode' }), null, 'pickRandom({stateMode}) with an unknown key returns null instead of throwing');

// filterEligiblePool (cooldown exclusion, from the smarter-shuffle feature)
// applies identically on the stateMode path -- it's the same shared call,
// not a per-branch reimplementation.
HypeAudio.toggleDislikeCooldown('mode1');
for (let i = 0; i < 15; i++) {
  assertEqual(HypeAudio.pickRandom({ stateMode: 'need_discipline' }).id, 'mode2', 'pickRandom({stateMode}) excludes a cooled-down clip the same way the plain pillar/mentality path already does');
}
HypeAudio.toggleDislikeCooldown('mode1'); // clear for cleanliness

// playStateMode -- single-shot wrapper Row calls (mirrors playPrRant's
// exact shape: pick once, play once, return the clip or null).
HypeAudio.addClip({ id: 'heavy1', title: 'Heavy Test', pillar: 'mindset', mentality: 'goggins', play_count: 0 });
const heavyPick = HypeAudio.playStateMode('heavy_day');
assertEqual(!!heavyPick, true, 'playStateMode plays a clip when the mode has eligible clips');
assertEqual(HypeAudio.getCurrentClip().id, heavyPick.id, 'playStateMode actually starts playback of the picked clip');
HypeAudio.stopPlayback();
assertEqual(HypeAudio.playStateMode('not_a_real_mode'), null, 'playStateMode on an unknown key returns null and plays nothing');
assertEqual(HypeAudio.getCurrentClip(), null, 'playStateMode on an unknown key does not disturb playback state');

// isPlayingRandomFilter distinguishes one state-mode loop from another
// (and from a plain pillar/mentality or moment loop), same exact-match
// pattern already covers for those.
HypeAudio.playRandomLoop({ stateMode: 'need_discipline' });
assertEqual(HypeAudio.isPlayingRandomFilter({ stateMode: 'need_discipline' }), true, 'isPlayingRandomFilter is true for the exact active state-mode loop');
assertEqual(HypeAudio.isPlayingRandomFilter({ stateMode: 'heavy_day' }), false, 'isPlayingRandomFilter is false for a different state mode');
assertEqual(HypeAudio.isPlayingRandomFilter({ pillar: 'mindset' }), false, 'isPlayingRandomFilter is false for a plain pillar filter while a state-mode loop is active');
HypeAudio.stopPlayback();

// uploadClipFile rejects a 0-byte file before ever hitting the network --
// neither the signed-URL flow nor the Storage bucket's file_size_limit
// (a maximum only) reject an empty file otherwise.
(async function () {
  store['hype_audio_upload_secret'] = 'test-secret'; // pre-seed so getUploadSecret skips window.prompt
  const result = await HypeAudio.uploadClipFile({ size: 0, name: 'empty.mp3', type: 'audio/mpeg' });
  assertEqual(result.url, null, 'uploadClipFile rejects a 0-byte file');
  assertEqual(typeof result.error === 'string' && result.error.length > 0, true, 'uploadClipFile gives a real error message for a 0-byte file');

  console.log('hype-audio.selfcheck.js: all assertions passed');
})();

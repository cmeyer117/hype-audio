// Run with: node hype-audio.selfcheck.js
'use strict';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

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

console.log('hype-audio.selfcheck.js: all assertions passed');

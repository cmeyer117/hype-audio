// Run with: node cue-studio.selfcheck.js
// Own Cue Studio phase 1 (docs/superpowers/specs/2026-10-08-own-cue-studio-design.md): non-destructive trim and an exercise
// on your own clips. Metadata only: the original audio file and its storage_url are never touched.
'use strict';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

// A controllable Audio: events can be fired by hand, and every write to currentTime is recorded.
class FakeAudio {
  constructor(src) {
    this.src = src; this.paused = true; this.duration = NaN; this.readyState = 0;
    this._t = 0; this.seeks = []; this._l = {};
    FakeAudio.instances.push(this);
  }
  get currentTime() { return this._t; }
  set currentTime(v) { this.seeks.push(v); this._t = v; }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
  removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter((f) => f !== fn); }
  fire(type) {
    (this._l[type] || []).slice().forEach((f) => f.call(this));
    const h = this['on' + type];
    if (typeof h === 'function') h.call(this);
  }
  play() { this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.fire('pause'); }
}
FakeAudio.instances = [];
global.Audio = FakeAudio;

const H = require('./hype-audio.js');

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures += 1; console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}
const reset = () => { for (const k of Object.keys(store)) delete store[k]; FakeAudio.instances.length = 0; H.stopPlayback(); };
const clip = (over) => Object.assign({ id: 'c', title: 'T', mentality: 'faith', pillar: 'carl', moment: 'mid_set', storage_url: 'https://x/c.webm', play_count: 0 }, over);

// ---- normalizeTrim (pure) ----
eq(H.normalizeTrim({ trim_start: 3, trim_end: 8 }, 25), { start: 3, end: 8 }, 'a valid window');
eq(H.normalizeTrim({ trim_start: 3 }, 25), { start: 3, end: null }, 'start only plays to the end');
eq(H.normalizeTrim({ trim_end: 8 }, 25), { start: 0, end: 8 }, 'end only starts at 0');
eq(H.normalizeTrim({}, 25), null, 'no trim fields');
eq(H.normalizeTrim(null, 25), null, 'no clip');
eq(H.normalizeTrim({ trim_start: 8, trim_end: 3 }, 25), null, 'start after end is ignored');
eq(H.normalizeTrim({ trim_start: 5, trim_end: 5.3 }, 25), null, 'a window under half a second is ignored');
eq(H.normalizeTrim({ trim_start: 30, trim_end: 40 }, 25), null, 'a window entirely beyond the file is ignored');
eq(H.normalizeTrim({ trim_start: 3, trim_end: 40 }, 25), { start: 3, end: null }, 'an end beyond the file just means play to the end');
eq(H.normalizeTrim({ trim_start: 24.8 }, 25), null, 'a start leaving under half a second is ignored');
for (const bad of [NaN, Infinity, -1, '3', null, undefined, {}, []]) {
  eq(H.normalizeTrim({ trim_start: bad, trim_end: bad }, 25), null, 'junk trim values are ignored: ' + String(JSON.stringify(bad)));
}
eq(H.normalizeTrim({ trim_start: 3, trim_end: 8 }, undefined), { start: 3, end: 8 }, 'an unknown duration trusts the stored window');
eq(H.normalizeTrim({ trim_start: 3, trim_end: 8 }, NaN), { start: 3, end: 8 }, 'a NaN duration is treated as unknown');

// ---- normalizeExerciseName (pure) ----
eq(H.normalizeExerciseName('  Bench   Press '), 'bench press', 'case and whitespace');
eq(H.normalizeExerciseName('Hack-Squat!!'), 'hack-squat', 'punctuation other than a hyphen is dropped');
eq(H.normalizeExerciseName('<img src=x onerror=alert(1)>'), 'img srcx onerroralert1', 'markup characters can never survive');
eq(H.normalizeExerciseName('a'.repeat(100)).length, 60, 'capped at 60 characters');
eq(H.normalizeExerciseName('   '), null, 'blank is no exercise');
eq(H.normalizeExerciseName(null), null, 'null is no exercise');
eq(H.normalizeExerciseName(42), null, 'a non-string is no exercise');

// ---- setClipCue: metadata only ----
reset();
H.addClip(clip({ id: 'a' }));
H.setClipCue('a', { trimStart: 2, trimEnd: 9, exercise: 'Bench Press' });
let c = H.listClips()[0];
eq([c.trim_start, c.trim_end, c.exercise], [2, 9, 'bench press'], 'trim and exercise are stored normalised');
eq(c.storage_url, 'https://x/c.webm', 'the original file reference is never modified');
H.setClipCue('a', { trimStart: null, trimEnd: null, exercise: '' });
c = H.listClips()[0];
eq(['trim_start' in c, 'trim_end' in c, 'exercise' in c], [false, false, false], 'clearing removes the fields (the original is one tap away)');
H.setClipCue('a', { trimStart: 9, trimEnd: 2 });
eq(['trim_start' in H.listClips()[0], 'trim_end' in H.listClips()[0]], [false, false], 'an invalid window is not stored');
H.setClipCue('missing', { trimStart: 1, trimEnd: 5 });
eq(H.listClips().length, 1, 'an unknown id changes nothing');

// ---- playback: trim applies in playSingle ----
reset();
H.addClip(clip({ id: 'a', trim_start: 3, trim_end: 8 }));
H.addClip(clip({ id: 'b' }));
H.playFromList(H.listClips(), 'a');
let a1 = FakeAudio.instances[0];
eq(a1.seeks, [], 'no seek before metadata is known');
a1.duration = 25; a1.readyState = 1; a1.fire('loadedmetadata');
eq(a1.seeks, [3], 'seeks to the trim start once metadata is available');
a1._t = 7.9; a1.fire('timeupdate');
eq([a1.paused, FakeAudio.instances.length], [false, 1], 'still inside the window: keeps playing');
a1._t = 8.02; a1.fire('timeupdate');
eq([a1.paused, FakeAudio.instances.length], [true, 2], 'at the trim end: stops and advances to the next clip');
a1.fire('timeupdate'); a1.fire('ended');
eq(FakeAudio.instances.length, 2, 'a late timeupdate or the natural ended never advances a second time');

// metadata already available when playback starts
reset();
H.addClip(clip({ id: 'a', trim_start: 4 }));
const orig = global.Audio;
global.Audio = function (src) { const x = new FakeAudio(src); x.duration = 30; x.readyState = 4; return x; };
H.playClip(H.listClips()[0]);
eq(FakeAudio.instances[0].seeks, [4], 'metadata already present: seeks immediately');
global.Audio = orig;

// a clip without a trim behaves as before
reset();
H.addClip(clip({ id: 'p' }));
H.playClip(H.listClips()[0]);
const plain = FakeAudio.instances[0];
plain.duration = 25; plain.readyState = 1; plain.fire('loadedmetadata'); plain._t = 20; plain.fire('timeupdate');
eq([plain.seeks, plain.paused], [[], false], 'no trim: never seeks and never stops early');

// a trim beyond the real duration is ignored (plays the whole clip)
reset();
H.addClip(clip({ id: 'q', trim_start: 40, trim_end: 50 }));
H.playClip(H.listClips()[0]);
const beyond = FakeAudio.instances[0];
beyond.duration = 25; beyond.readyState = 1; beyond.fire('loadedmetadata'); beyond._t = 20; beyond.fire('timeupdate');
eq([beyond.seeks, beyond.paused], [[], false], 'an out-of-range trim is ignored');

// play_count still counts once, on the real play event
reset();
H.addClip(clip({ id: 'n', trim_start: 1, trim_end: 6 }));
H.playClip(H.listClips()[0]);
const n1 = FakeAudio.instances[0];
n1.duration = 25; n1.readyState = 1; n1.fire('loadedmetadata'); n1._t = 6.1; n1.fire('timeupdate');
eq(H.listClips()[0].play_count, 1, 'a trimmed play is counted exactly once');

// repeat mode keeps working with a trim (the stop at the end re-enters the repeat)
reset();
H.addClip(clip({ id: 'r', trim_start: 1, trim_end: 6 }));
H.playRepeat(H.listClips()[0]);
const r1 = FakeAudio.instances[0];
r1.duration = 25; r1.readyState = 1; r1.fire('loadedmetadata'); r1._t = 6.1; r1.fire('timeupdate');
eq(FakeAudio.instances.length, 2, 'repeat plays the trimmed window again');

// ---- exercise preference for the mid-set pick ----
reset();
H.addClip(clip({ id: 'g1', exercise: undefined }));
H.addClip(clip({ id: 'g2' }));
H.addClip(clip({ id: 'x1', exercise: 'bench press' }));
H.addClip(clip({ id: 'x2', exercise: 'hack squat' }));
const picks = (ex) => { const s = new Set(); for (let i = 0; i < 60; i += 1) { H.stopPlayback(); s.add(H.pickMidSetClip(ex).id); } return [...s].sort(); };
eq(picks('Bench Press'), ['x1'], 'a matching exercise cue is preferred (and the argument is normalised)');
eq(picks('deadlift'), ['g1', 'g2', 'x1', 'x2'], 'no clip for that exercise: falls back to the whole pool');
eq(picks(undefined), ['g1', 'g2', 'x1', 'x2'], 'no argument: unchanged behaviour');
eq(picks(''), ['g1', 'g2', 'x1', 'x2'], 'a blank exercise: unchanged behaviour');
eq(H.playMidSetHype('hack squat').id, 'x2', 'playMidSetHype passes the exercise through');


// ---- Codex spec review: restart, preview and hostile synced data ----

// the media-session "restart" (and "previous" within the first seconds) must respect the trim, not jump to 0 / the file start
reset();
H.addClip(clip({ id: 'm', trim_start: 3, trim_end: 8 }));
H.playClip(H.listClips()[0]);
const m1 = FakeAudio.instances[0];
m1.duration = 25; m1.readyState = 1; m1.fire('loadedmetadata'); m1._t = 6;
m1.seeks.length = 0;
H.restartCurrent();
eq(m1.seeks, [3], 'restart seeks to the trim start, not to 0');
reset();
H.addClip(clip({ id: 'u' }));
H.playClip(H.listClips()[0]);
const u1 = FakeAudio.instances[0]; u1._t = 9; u1.seeks.length = 0;
H.restartCurrent();
eq(u1.seeks, [0], 'an untrimmed clip still restarts at 0');
eq(H.restartCurrent === undefined, false, 'restartCurrent is exported');

// "previous" counts time since the trim start: just after a trimmed clip begins it should still go to the previous clip
reset();
H.addClip(clip({ id: 'p1' }));
H.addClip(clip({ id: 'p2', trim_start: 10, trim_end: 20 }));
H.playFromList(H.listClips(), 'p2');
const p2a = FakeAudio.instances[0];
p2a.duration = 30; p2a.readyState = 1; p2a.fire('loadedmetadata');
eq(H.secondsIntoCurrent(), 0, 'seconds into a trimmed clip are measured from the trim start');
p2a._t = 12.5;
eq(H.secondsIntoCurrent(), 2.5, 'and keep counting from there');

// the editor's preview: its own audio element, stops at the end, calls back once, never advances a queue
reset();
H.addClip(clip({ id: 'q1' }));
H.addClip(clip({ id: 'q2' }));
H.playFromList(H.listClips(), 'q1');
const before = FakeAudio.instances.length;
const prev = new FakeAudio('blob:preview');
prev.duration = 25; prev.readyState = 1;
let ended = 0;
H.watchTrim(prev, { trim_start: 2, trim_end: 6 }, () => { ended += 1; });
eq(prev.seeks, [2], 'the preview seeks to the window start');
prev._t = 6.05; prev.fire('timeupdate'); prev.fire('timeupdate');
eq([prev.paused, ended, FakeAudio.instances.length - 1], [true, 1, before], 'stops once at the end, calls back once, and never advances the playback queue');

// hostile synced data: exercise is normalised again at the match boundary, never trusted as stored
reset();
H.addClip(clip({ id: 'h1', exercise: '<img src=x onerror=alert(1)>' }));
H.addClip(clip({ id: 'h2', exercise: { not: 'a string' } }));
H.addClip(clip({ id: 'h3', exercise: 'BENCH   Press' })); // written by something that did not normalise
H.addClip(clip({ id: 'h4' }));
const hp = new Set(); for (let i = 0; i < 60; i += 1) { H.stopPlayback(); hp.add(H.pickMidSetClip('bench press').id); }
eq([...hp], ['h3'], 'a stored exercise that was not normalised still matches; a hostile or non-string one never does');
const hostile = new Set(); for (let i = 0; i < 60; i += 1) { H.stopPlayback(); hostile.add(H.pickMidSetClip('<>!!').id); }
eq(hostile.size > 1, true, 'an exercise argument that normalises to nothing falls back to the whole pool, without throwing');
// a hostile stored value and an identical hostile argument normalise to the same harmless plain text, so they match: nothing but
// letters, digits, spaces and hyphens can ever be compared, stored or rendered
eq(H.normalizeExerciseName('<img src=x onerror=alert(1)>').includes('<'), false, 'normalised text never contains markup characters');

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('cue-studio selfcheck: all checks passed');

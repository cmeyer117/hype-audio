// Run with: node quote-bed-integration.selfcheck.js
// Quote-over-bed (docs/superpowers/specs/2026-10-09-quote-over-bed-design.md): hype-audio.js + the real quote-bed.js controller together,
// fake audio/context. Covers bed selection, the pin, the playback invariants and the "quote is never affected" failure modes.
'use strict';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

class FakeAudio {
  constructor(src) { this.src = src; this.paused = true; this.ended = false; this.duration = NaN; this.readyState = 0; this._t = 0; this._l = {}; this.plays = 0; FakeAudio.instances.push(this); }
  get currentTime() { return this._t; }
  set currentTime(v) { this._t = v; }
  addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
  removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter((f) => f !== fn); }
  fire(type) { (this._l[type] || []).slice().forEach((f) => f.call(this)); const h = this['on' + type]; if (typeof h === 'function') h.call(this); }
  play() { this.plays += 1; this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.fire('pause'); }
}
FakeAudio.instances = [];
global.Audio = FakeAudio;

const timers = [];
const ctx = {
  currentTime: 0, destination: {}, resume: () => Promise.resolve(),
  createMediaElementSource: () => ({ connect() {} }),
  createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }),
};
const QB = require('./quote-bed.js');
let ctl = null;
function installMixer(env) {
  ctl = QB.createController(Object.assign({ AudioCtor: FakeAudio, getContext: () => ctx, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimer() {}, warn() {} }, env || {}));
  global.QuoteBed = ctl;
}
installMixer();

const H = require('./hype-audio.js');

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures += 1; console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}
const reset = () => { for (const k of Object.keys(store)) delete store[k]; FakeAudio.instances.length = 0; timers.length = 0; H.stopPlayback(); installMixer(); };
const mk = (over) => Object.assign({ title: 'T', mentality: 'faith', pillar: 'carl', moment: 'mid_set', storage_url: 'https://x/c.mp3', play_count: 0 }, over);
const quote = (over) => mk(Object.assign({ delivery_role: 'motivational_speech' }, over));
const bed = (over) => mk(Object.assign({ delivery_role: 'instrumental' }, over));
const bedUrls = () => FakeAudio.instances.filter((a) => /bed/.test(a.src)).map((a) => a.src);

(async () => {
  // ---- classification ----
  eq([H.isQuoteClip(quote({ id: 'q' })), H.isQuoteClip(bed({ id: 'b' })), H.isQuoteClip(null)], [true, false, false], 'isQuoteClip');
  eq(['music', 'instrumental', 'noise', 'motivational_speech', 'scripture_prayer', undefined].map((r) => H.isBedClip({ delivery_role: r })), [true, true, true, false, false, false], 'isBedClip only for music/instrumental/noise');
  eq(H.isBedClip({ delivery_role: 'music', deleted: true }), false, 'a deleted bed is not a bed');

  // ---- pickBedFor: pin > pillar+mentality > pillar > none ----
  reset();
  H.addClip(bed({ id: 'bf', storage_url: 'https://x/bed-faith.mp3', mentality: 'faith' }));
  H.addClip(bed({ id: 'bg', storage_url: 'https://x/bed-grit.mp3', mentality: 'grit' }));
  H.addClip(bed({ id: 'bi', storage_url: 'https://x/bed-iron.mp3', pillar: 'iron', mentality: 'faith' }));
  const q = quote({ id: 'q', mentality: 'faith' });
  H.addClip(q);
  const seen = new Set(); for (let i = 0; i < 40; i += 1) seen.add(H.pickBedFor(q).id);
  eq([...seen], ['bf'], 'same pillar and mentality wins');
  const q2 = quote({ id: 'q2', mentality: 'nothing-matches' });
  const seen2 = new Set(); for (let i = 0; i < 80; i += 1) seen2.add(H.pickBedFor(q2).id);
  eq([...seen2].sort(), ['bf', 'bg'], 'no mentality match: any bed of the same pillar (never another pillar)');
  eq(H.pickBedFor(quote({ id: 'q3', pillar: 'mindset' })), null, 'no bed in the pillar: none');
  eq(H.pickBedFor(quote({ id: 'q4', bed_id: 'bi' })).id, 'bi', 'a pinned bed wins even from another pillar');
  for (const bad of ['nope', '<img src=x onerror=1>', 5, {}, [], null, 'q']) {
    const got = H.pickBedFor(quote({ id: 'qb', mentality: 'faith', bed_id: bad }));
    eq(got && got.id, 'bf', 'a junk/non-bed bed_id is ignored: ' + JSON.stringify(bad));
  }
  eq(H.pickBedFor(bed({ id: 'x' })), null, 'a bed is not given a bed');
  reset();
  H.addClip(bed({ id: 'bd', storage_url: 'https://x/bed-d.mp3', mentality: 'faith' }));
  const gone = bed({ id: 'bz', storage_url: 'https://x/bed-z.mp3', mentality: 'faith' }); H.addClip(gone);
  H.deleteClip && H.deleteClip('bz');
  eq(H.pickBedFor(quote({ id: 'qq', bed_id: 'bz', mentality: 'faith' })).id, 'bd', 'a pin to a deleted bed falls back');

  // ---- setClipBed ----
  reset();
  H.addClip(bed({ id: 'b1', storage_url: 'https://x/bed-1.mp3' })); H.addClip(quote({ id: 'q1', storage_url: 'https://x/q1.mp3' }));
  H.setClipBed('q1', 'b1');
  eq(H.listClips().find((c) => c.id === 'q1').bed_id, 'b1', 'setClipBed pins');
  eq(H.listClips().find((c) => c.id === 'q1').storage_url, 'https://x/q1.mp3', 'and never touches the audio url');
  H.setClipBed('q1', 'q1');
  eq('bed_id' in H.listClips().find((c) => c.id === 'q1'), false, 'a bed_id that is not a bed is not stored (and the old pin is cleared)');
  H.setClipBed('q1', 'b1'); H.setClipBed('q1', null);
  eq('bed_id' in H.listClips().find((c) => c.id === 'q1'), false, 'a falsy bed id clears the pin');
  H.setClipBed('nope', 'b1');

  // ---- playback: a quote starts a bed; invariants hold ----
  reset();
  H.addClip(bed({ id: 'b1', storage_url: 'https://x/bed-1.mp3' }));
  H.addClip(quote({ id: 'q1', storage_url: 'https://x/q1.mp3', play_count: 0 }));
  H.addClip(mk({ id: 'plain', storage_url: 'https://x/plain.mp3' }));
  const a = H.playClip(H.listClips().find((c) => c.id === 'q1'));
  eq(bedUrls(), ['https://x/bed-1.mp3'], 'playing a quote starts exactly one bed');
  eq(H.getCurrentClip().id, 'q1', 'the quote, not the bed, is the current clip');
  eq(H.listClips().find((c) => c.id === 'b1').play_count, 0, 'the bed never gets a play count');
  eq(H.listClips().find((c) => c.id === 'q1').play_count, 1, 'the quote does');
  eq(a.crossOrigin, undefined, 'the quote element has no crossOrigin');
  eq(ctl.isActive(), true, 'bed active');
  H.playClip(H.listClips().find((c) => c.id === 'plain'));
  eq(ctl.isActive(), false, 'starting a plain clip stops the bed');
  eq(bedUrls().length, 1, 'and does not start another');
  H.playClip(H.listClips().find((c) => c.id === 'q1'));
  eq(ctl.isActive(), true, 'a quote again: new bed');
  H.stopPlayback();
  eq(ctl.isActive(), false, 'stopPlayback stops the bed');
  const a2 = H.playClip(H.listClips().find((c) => c.id === 'q1'));
  a2.fire('pause'); // user pause
  eq(FakeAudio.instances.filter((x) => /bed/.test(x.src)).pop().paused, true, 'user pause pauses the bed');
  a2.fire('play');
  eq(FakeAudio.instances.filter((x) => /bed/.test(x.src)).pop().paused, false, 'resume resumes it');
  // natural end of the last clip: pause (ended) then ended -> finish -> swell, tail timer releases
  a2.ended = true; a2.fire('pause'); a2.fire('ended');
  eq(ctl.isActive(), true, 'after the natural end the bed rings on briefly');
  timers.slice().forEach((t) => t.fn());
  eq(ctl.isActive(), false, 'then the tail timer releases it');

  // ---- trim end of a quote ----
  reset();
  H.addClip(bed({ id: 'b1', storage_url: 'https://x/bed-1.mp3' }));
  H.addClip(quote({ id: 'qt', storage_url: 'https://x/qt.mp3', trim_start: 1, trim_end: 4 }));
  const t = H.playClip(H.listClips().find((c) => c.id === 'qt'));
  t.duration = 20; t.readyState = 1; t.fire('loadedmetadata');
  t.currentTime = 4.1; t.fire('timeupdate');
  eq(t.paused, true, 'the trim end pauses the quote');
  eq(ctl.isActive(), true, 'and the bed swells and rings on instead of dying instantly');
  timers.slice().forEach((tm) => tm.fn());
  eq(ctl.isActive(), false, 'then releases');

  // ---- setting off / no mixer / mixer failures: the quote plays exactly as before ----
  reset();
  H.addClip(bed({ id: 'b1', storage_url: 'https://x/bed-1.mp3' })); H.addClip(quote({ id: 'q1', storage_url: 'https://x/q1.mp3' }));
  H.setQuoteBed(false);
  eq(H.getQuoteBed(), false, 'setting reads back off');
  H.playClip(H.listClips().find((c) => c.id === 'q1'));
  eq([bedUrls().length, ctl.isActive()], [0, false], 'setting off: no bed');
  H.setQuoteBed(true);
  eq(H.getQuoteBed(), true, 'on again');
  global.QuoteBed = null;
  const solo = H.playClip(H.listClips().find((c) => c.id === 'q1'));
  eq([solo.paused, H.getCurrentClip().id], [false, 'q1'], 'mixer script not loaded: the quote plays alone');
  installMixer({ getContext: () => null });
  const solo2 = H.playClip(H.listClips().find((c) => c.id === 'q1'));
  eq([solo2.paused, ctl.isActive()], [false, false], 'no AudioContext: the quote plays alone');
  global.QuoteBed = { attach() { throw new Error('boom'); }, quoteEnded() { throw new Error('boom'); }, stop() { throw new Error('boom'); } };
  let threw = false; let solo3;
  try { solo3 = H.playClip(H.listClips().find((c) => c.id === 'q1')); solo3.fire('ended'); H.stopPlayback(); } catch (e) { threw = true; }
  eq(threw, false, 'a mixer that throws can never break playback');
  installMixer();

  // ---- a quote in a queue: the bed follows each quote, one at a time ----
  reset();
  H.addClip(bed({ id: 'b1', storage_url: 'https://x/bed-1.mp3' }));
  H.addClip(quote({ id: 'qa', storage_url: 'https://x/qa.mp3' })); H.addClip(quote({ id: 'qb', storage_url: 'https://x/qb.mp3' }));
  const first = H.playFromList(H.listClips().filter((c) => c.id.startsWith('q')), 'qa');
  first.ended = true; first.fire('pause'); first.fire('ended');
  eq(H.getCurrentClip().id, 'qb', 'the queue advanced to the next quote');
  eq(bedUrls().length, 2, 'one bed per quote');
  eq(ctl.isActive(), true, 'exactly one bed is live');
  H.stopPlayback();
  eq(ctl.isActive(), false, 'and it stops with the queue');

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('quote-bed integration selfcheck: all checks passed');
})();

// Run with: node quote-bed.selfcheck.js
// Quote-over-bed mixer (docs/superpowers/specs/2026-10-09-quote-over-bed-design.md): the controller alone, with fake audio, context and timers.
'use strict';
const QB = require('./quote-bed.js');

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures += 1; console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}

class FakeEl {
  constructor(src) { this.src = src; this.paused = true; this.ended = false; this._l = {}; this.plays = 0; this.pauses = 0; this.rejectPlay = false; FakeEl.all.push(this); }
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  removeEventListener(t, fn) { this._l[t] = (this._l[t] || []).filter((f) => f !== fn); }
  fire(t) { (this._l[t] || []).slice().forEach((f) => f.call(this)); }
  play() { this.plays += 1; if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError')); this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { this.pauses += 1; this.paused = true; this.fire('pause'); }
  listeners(t) { return (this._l[t] || []).length; }
}
FakeEl.all = [];

function makeEnv(opts) {
  opts = opts || {};
  const timers = [];
  const ctx = {
    currentTime: 0, resumed: 0, sources: 0,
    destination: {},
    resume() { this.resumed += 1; return opts.resumeRejects ? Promise.reject(new Error('suspended')) : Promise.resolve(); },
    createMediaElementSource() { ctx.sources += 1; if (opts.sourceThrows) throw new Error('MediaElementAudioSource: cross-origin'); return { connect() {} }; },
    createGain() {
      const ops = [];
      const g = { value: 0, ops, setValueAtTime(v, t) { this.value = v; ops.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { ops.push(['ramp', v, +(t - ctx.currentTime).toFixed(2)]); this.value = v; }, cancelScheduledValues() { ops.push(['cancel']); } };
      ctx.gains.push(g);
      return { gain: g, connect() {} };
    },
    gains: [],
  };
  const warns = [];
  return {
    ctx, timers, warns,
    env: {
      AudioCtor: FakeEl,
      getContext: () => (opts.noContext ? null : ctx),
      setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
      clearTimer: (id) => { if (timers[id]) timers[id].live = false; },
      warn: (m) => warns.push(m),
    },
    runTimers() { timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); }); },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const lastRamp = (g) => g.ops.filter((o) => o[0] === 'ramp').pop();

(async () => {
  // ---- start: bed routed through WebAudio, crossOrigin set, loops, ducked ramp ----
  {
    FakeEl.all.length = 0;
    const m = makeEnv(); const c = QB.createController(m.env);
    const quote = new FakeEl('q.mp3');
    quote.paused = false;
    eq(c.attach(quote, 'https://x/bed.mp3'), true, 'attach returns true when a bed starts');
    const bed = FakeEl.all[1];
    eq([bed.crossOrigin, bed.loop, bed.src, bed.plays], ['anonymous', true, 'https://x/bed.mp3', 1], 'bed element: crossOrigin, loop, src, started once');
    eq(quote.crossOrigin, undefined, 'the quote element is never given a crossOrigin');
    eq(m.ctx.sources, 1, 'exactly one element is routed through WebAudio (the bed)');
    eq(m.ctx.resumed, 1, 'the context is resumed inside the attach call');
    eq(lastRamp(m.ctx.gains[0]), ['ramp', QB.DUCK_LEVEL, 0.8], 'the bed ramps in straight to the duck level (no pre-roll)');
    eq(c.isActive(), true, 'active');
    // user pause / resume
    quote.fire('pause');
    eq(bed.paused, true, 'quote pause pauses the bed');
    quote.fire('play');
    eq(bed.paused, false, 'quote play resumes the bed');
    // natural end: pause fires first with ended=true; the bed keeps going until quoteEnded()
    quote.ended = true; quote.fire('pause');
    eq(bed.paused, false, 'a natural-end pause does not silence the bed');
    c.quoteEnded();
    eq(lastRamp(m.ctx.gains[0]), ['ramp', QB.BED_LEVEL, 0.6], 'the bed swells after the quote ends');
    m.runTimers();
    eq(c.isActive(), false, 'the tail timer releases the bed');
    eq(lastRamp(m.ctx.gains[0]), ['ramp', 0, 1.2], 'and fades it out slowly');
    m.runTimers();
    eq(bed.paused, true, 'the bed element is paused after the fade');
    eq([quote.listeners('pause'), quote.listeners('play')], [0, 0], 'quote listeners are removed on release');
    c.quoteEnded(); c.stop(); c.stop();
    eq(c.isActive(), false, 'stop / quoteEnded after release are harmless');
  }

  // ---- a trim end: quote pauses (ended=false), then quoteEnded() brings the paused bed back for the swell ----
  {
    FakeEl.all.length = 0;
    const m = makeEnv(); const c = QB.createController(m.env);
    const quote = new FakeEl('q.mp3'); quote.paused = false;
    c.attach(quote, 'b.mp3'); const bed = FakeEl.all[1];
    quote.fire('pause');
    eq(bed.paused, true, 'trim end pauses the quote, which pauses the bed first');
    c.quoteEnded();
    eq([bed.paused, lastRamp(m.ctx.gains[0])], [false, ['ramp', QB.BED_LEVEL, 0.6]], 'quoteEnded resumes the bed and swells');
  }

  // ---- replacement and stop: at most one bed, fast fade, idempotent ----
  {
    FakeEl.all.length = 0;
    const m = makeEnv(); const c = QB.createController(m.env);
    const q1 = new FakeEl('q1'); const q2 = new FakeEl('q2');
    c.attach(q1, 'b1.mp3');
    c.attach(q2, 'b2.mp3');
    const g1 = m.ctx.gains[0];
    eq(lastRamp(g1), ['ramp', 0, 0.4], 'starting another quote fades the previous bed out fast');
    eq([q1.listeners('pause'), q1.listeners('play')], [0, 0], 'the previous quote is detached');
    q1.fire('pause'); q1.fire('play');
    eq(FakeEl.all.filter((e) => e.src === 'b1.mp3')[0].plays, 1, 'a stale quote event cannot restart the old bed');
    c.stop(); c.stop();
    eq(c.isActive(), false, 'stop twice ends everything');
    m.runTimers();
    eq(FakeEl.all.filter((e) => /^b/.test(e.src)).every((e) => e.paused), true, 'no bed is left playing');
  }

  // ---- failure modes: the quote must never be affected ----
  {
    FakeEl.all.length = 0;
    let m = makeEnv({ noContext: true }); let c = QB.createController(m.env);
    eq(c.attach(new FakeEl('q'), 'b.mp3'), false, 'no AudioContext: no bed, no throw');
    m = makeEnv({ sourceThrows: true }); c = QB.createController(m.env);
    eq(c.attach(new FakeEl('q'), 'b.mp3'), false, 'a bed that cannot be routed (cross-origin) is dropped');
    eq(m.warns.length >= 1, true, 'and the reason is logged');
    m = makeEnv({ resumeRejects: true }); c = QB.createController(m.env);
    const q = new FakeEl('q'); c.attach(q, 'b.mp3'); await flush();
    eq(c.isActive(), false, 'resume() rejecting drops the bed');
    m = makeEnv(); c = QB.createController(m.env);
    FakeEl.prototype.rejectPlay = false;
    const q2 = new FakeEl('q');
    const orig = FakeEl.prototype.play;
    FakeEl.prototype.play = function () { if (/rej/.test(this.src)) return Promise.reject(new Error('NotAllowedError')); return orig.call(this); };
    c.attach(q2, 'rej.mp3'); await flush();
    eq(c.isActive(), false, 'a rejected bed.play() drops the bed');
    FakeEl.prototype.play = orig;
    m = makeEnv(); c = QB.createController(m.env);
    const q3 = new FakeEl('q'); c.attach(q3, 'b.mp3');
    FakeEl.all[FakeEl.all.length - 1].fire('error');
    eq(c.isActive(), false, 'a bed media error drops the bed');
    for (const bad of [undefined, null, '', 5, {}]) eq(QB.createController(makeEnv().env).attach(new FakeEl('q'), bad), false, 'a missing/invalid bed url starts nothing: ' + JSON.stringify(bad));
    eq(QB.createController(makeEnv().env).attach(null, 'b.mp3'), false, 'no quote element: nothing');
  }

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('quote-bed selfcheck: all checks passed');
})();

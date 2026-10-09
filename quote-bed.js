// Quote-over-bed mixer (docs/superpowers/specs/2026-10-09-quote-over-bed-design.md).
// A quote clip plays on its own plain <audio> element, untouched; ONLY the background bed is routed through WebAudio so its level can
// duck under the voice (iPhone Safari ignores audio.volume). If the bed route fails for any reason the bed is dropped and the quote
// plays on. Loaded before hype-audio.js; hype-audio.js calls attach() synchronously from playSingle (inside the user's tap), stop()
// whenever a new clip starts or playback stops, and quoteEnded() from the quote's finish.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuoteBed = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const BED_LEVEL = 0.45;   // bed volume when nobody is talking
  const DUCK_LEVEL = 0.18;  // bed volume under the voice
  const RAMP_IN = 0.8;      // seconds to reach the duck level at the start
  const SWELL = 0.6;        // seconds to rise to the bed level after the quote ends
  const TAIL_MS = 1500;     // how long the bed rings on after the quote ends
  const FADE_OUT = 1.2;     // seconds to fade out after the tail
  const FAST_FADE = 0.4;    // seconds to fade out when another clip takes over or playback stops

  function defaultEnv() {
    let ctx = null;
    return {
      AudioCtor: typeof Audio !== 'undefined' ? Audio : null,
      getContext: function () {
        if (ctx) return ctx;
        const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
        if (!Ctor) return null;
        ctx = new Ctor();
        return ctx;
      },
      setTimer: function (fn, ms) { return setTimeout(fn, ms); },
      clearTimer: function (id) { clearTimeout(id); },
      warn: function (msg, err) { if (typeof console !== 'undefined') console.warn('[quote-bed] ' + msg, err || ''); },
    };
  }

  // env is injectable for the self-check: { AudioCtor, getContext, setTimer, clearTimer, warn }.
  function createController(envIn) {
    const env = Object.assign(defaultEnv(), envIn || {});
    let gen = 0;   // bumped by every attach and every release: a callback holding an older number is stale and does nothing
    let cur = null;

    function ramp(c, level, seconds) {
      try {
        const g = c.gain.gain;
        const t = c.ctx.currentTime;
        if (g.cancelScheduledValues) g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(level, t + seconds);
      } catch (e) { env.warn('gain ramp failed', e); }
    }

    function playBed(c, my) {
      let p;
      try { p = c.bed.play(); } catch (e) { drop(my, e); return; }
      if (p && typeof p.catch === 'function') p.catch(function (e) { drop(my, e); });
    }

    // Idempotent. fast = the short fade used when something else takes over.
    function release(fast) {
      const c = cur;
      if (!c) return;
      cur = null;
      gen += 1;
      c.timers.forEach(function (id) { env.clearTimer(id); });
      c.timers.length = 0;
      try { c.quoteAudio.removeEventListener('pause', c.onPause); } catch (e) {}
      try { c.quoteAudio.removeEventListener('play', c.onPlay); } catch (e) {}
      try { c.bed.removeEventListener('error', c.onError); } catch (e) {}
      const seconds = fast ? FAST_FADE : FADE_OUT;
      ramp(c, 0, seconds);
      // this timer belongs to the released bed alone, so it is deliberately not generation-guarded
      env.setTimer(function () { try { c.bed.pause(); } catch (e) {} }, Math.round(seconds * 1000) + 50);
    }

    function drop(my, err) {
      if (my !== gen) return;
      env.warn('background bed dropped; the quote keeps playing', err);
      const c = cur;
      if (c) { try { c.bed.pause(); } catch (e) {} }
      release(true);
    }

    // quoteAudio: the quote's own <audio>. bedUrl: the bed clip's storage_url. Returns true when a bed was started.
    function attach(quoteAudio, bedUrl) {
      release(true);
      if (!quoteAudio || typeof bedUrl !== 'string' || !bedUrl) return false;
      const my = gen + 1;
      let ctx = null;
      try { ctx = env.getContext(); } catch (e) { env.warn('no audio context', e); }
      if (!ctx || !env.AudioCtor) return false;
      let bed, gain;
      try {
        bed = new env.AudioCtor();
        bed.crossOrigin = 'anonymous';
        bed.loop = true;
        bed.src = bedUrl;
        const source = ctx.createMediaElementSource(bed);
        gain = ctx.createGain();
        gain.gain.setValueAtTime(0, ctx.currentTime);
        source.connect(gain);
        gain.connect(ctx.destination);
      } catch (e) { env.warn('bed could not be routed', e); return false; }
      gen = my;
      const c = { bed: bed, gain: gain, ctx: ctx, quoteAudio: quoteAudio, timers: [] };
      c.onPause = function () {
        if (my !== gen) return;
        if (quoteAudio.ended) return; // a natural end fires pause first; quoteEnded() handles the swell
        try { bed.pause(); } catch (e) {}
      };
      c.onPlay = function () {
        if (my !== gen) return;
        ramp(c, DUCK_LEVEL, RAMP_IN);
        playBed(c, my);
      };
      c.onError = function () { drop(my, new Error('bed media error')); };
      cur = c;
      quoteAudio.addEventListener('pause', c.onPause);
      quoteAudio.addEventListener('play', c.onPlay);
      bed.addEventListener('error', c.onError);
      ramp(c, DUCK_LEVEL, RAMP_IN);
      try {
        const r = ctx.resume && ctx.resume();
        if (r && typeof r.catch === 'function') r.catch(function (e) { drop(my, e); });
      } catch (e) { drop(my, e); return false; }
      playBed(c, my);
      return cur === c;
    }

    // The quote finished (natural end or trim end): let the bed swell, ring on, and fade out.
    function quoteEnded() {
      const c = cur;
      if (!c) return;
      const my = gen;
      if (c.bed.paused) playBed(c, my);
      ramp(c, BED_LEVEL, SWELL);
      c.timers.push(env.setTimer(function () { if (my === gen && cur === c) release(false); }, TAIL_MS));
    }

    function stop() { release(true); }
    function isActive() { return cur !== null; }

    return { attach: attach, quoteEnded: quoteEnded, stop: stop, isActive: isActive };
  }

  const shared = createController();
  return {
    createController: createController,
    attach: shared.attach,
    quoteEnded: shared.quoteEnded,
    stop: shared.stop,
    isActive: shared.isActive,
    BED_LEVEL: BED_LEVEL,
    DUCK_LEVEL: DUCK_LEVEL,
  };
});

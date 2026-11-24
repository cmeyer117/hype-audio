const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/hype-audio.js', 'utf8');
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

(async () => {
  for (const stall of ['client', 'body']) {
    let now = 1000000, settleLate, signal, ready = false, finished = false;
    const pending = new Promise(resolve => settleLate = resolve);
    const timers = new Map(); let timerId = 0;
    const client = { from: () => ({ select: () => ({ eq: () => ({
      abortSignal(value) { signal = value; return this; },
      maybeSingle: () => ready ? Promise.resolve({ data: { data: { 'clip.mp3': { t: 'fresh' } } } }) : pending,
    }) }) }) };
    const context = { window: { HypeAuth: { getClient: () => stall === 'client' && !ready ? pending : client } },
      module: { exports: {} }, localStorage: { getItem: () => null }, AbortController,
      Date: class extends Date { static now() { return now; } },
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    };
    vm.runInNewContext(source, context);
    const H = context.module.exports;
    const first = H.ensureSideTranscripts().then(ok => { finished = true; return ok; });
    await drain();
    now += 8001;
    for (const fn of [...timers.values()]) fn();
    await drain();
    assert.equal(finished, true, stall + ': an unresolved read must reach its deadline');
    assert.equal(await first, false);
    if (stall === 'body') assert.equal(signal.aborted, true, 'abort the actual SDK request');
    assert.equal(H.sideTranscriptsLoaded(), false);
    now += 31000; ready = true;
    assert.equal(await H.ensureSideTranscripts(), true, 'the normal backoff can recover');
    settleLate(stall === 'client' ? client : { data: { data: { 'clip.mp3': { t: 'obsolete' } } } });
    await drain();
    assert.equal(H.transcriptOf({ storage_url: 'https://fixture.invalid/clip.mp3' }), 'fresh', 'late completion cannot overwrite the recovered cache');
    assert.equal(timers.size, 0, 'all deadline timers are released');
  }
  console.log('PASS stalled transcript acquisition recovers without a stale cache overwrite');
})().catch(error => { console.error(error); process.exitCode = 1; });

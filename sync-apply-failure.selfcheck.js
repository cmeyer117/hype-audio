// Run with: node sync-apply-failure.selfcheck.js
// Guard for the 2026-11-07 silent-catch audit: when applying remote state to localStorage throws
// (full or blocked store), sync.js used to swallow it and keep reporting "synced". It must now log
// once per streak via console.error and surface the retrying status; a normal apply does neither.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');
const casSource = fs.readFileSync(path.join(__dirname, 'hype-cas-write.js'), 'utf8');

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

function run(throwOnSet) {
  return new Promise((resolve) => {
    const statuses = [];
    const errors = [];
    const store = {};
    const remote = { hype_audio: [{ id: 'r1', title: 'remote clip', updated_at: 5 }] };
    const fakeSupa = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { data: remote, updated_at: 't1' }, error: null }) }) }),
      }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    };
    const sandbox = {
      window: {
        supabase: { createClient: () => fakeSupa },
        SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'selfcheck-key' },
        addEventListener() {},
      },
      document: { addEventListener() {}, visibilityState: 'visible' },
      localStorage: {
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i],
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (throwOnSet) throw new Error('QuotaExceededError'); store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      console: { error: (...a) => errors.push(a), log() {}, warn() {} },
      setTimeout, clearTimeout, JSON, Date, Object, Array, Promise, Map, String, Error,
    };
    vm.createContext(sandbox);
    vm.runInContext(casSource, sandbox);
    vm.runInContext(source, sandbox);
    sandbox.window.initCloudSync({
      appKey: 'hype-audio',
      syncedKeys: ['hype_audio'],
      onStatusChange: (status) => statuses.push(status),
    });
    setTimeout(() => resolve({ statuses, errors }), 400);
  });
}

// Push/apply interplay (independent review 2026-11-09): a failed inbound apply must not be cleared by a
// push, no push may go out while the apply is failing (local state may be stale), and a later successful
// apply must clear the failure and let pushing resume.
function runRecovery() {
  return new Promise((resolve) => {
    const statuses = [];
    const pushes = [];
    const store = {};
    let failing = true;
    let realtime = null;
    const remote = { hype_audio: [{ id: 'r1', title: 'remote clip', updated_at: 5 }] };
    const fakeSupa = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { data: remote, updated_at: 't1' }, error: null }) }) }),
        update: (row) => { pushes.push(row); return { eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ updated_at: 't2' }], error: null }) }) }) }; },
        insert: (row) => { pushes.push(row); return { select: () => Promise.resolve({ data: [{ updated_at: 't2' }], error: null }) }; },
      }),
      channel: () => ({ on(ev, filter, cb) { realtime = cb; return this; }, subscribe() { return this; } }),
    };
    const sandbox = {
      window: {
        supabase: { createClient: () => fakeSupa },
        SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'selfcheck-key' },
        addEventListener() {},
      },
      document: { addEventListener() {}, visibilityState: 'visible' },
      localStorage: {
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i],
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { if (failing) throw new Error('QuotaExceededError'); store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      console: { error() {}, log() {}, warn() {} },
      setTimeout, clearTimeout, JSON, Date, Object, Array, Promise, Map, String, Error,
    };
    vm.createContext(sandbox);
    vm.runInContext(casSource, sandbox);
    vm.runInContext(source, sandbox);
    sandbox.window.initCloudSync({
      appKey: 'hype-audio',
      syncedKeys: ['hype_audio'],
      onStatusChange: (status) => statuses.push(status),
    });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await wait(200); // init read: apply fails
      const afterInit = { last: statuses[statuses.length - 1], pushes: pushes.length };
      // A local edit while the apply is failing (the write itself succeeds, the incoming one did not).
      failing = false;
      sandbox.localStorage.setItem('hype_audio', JSON.stringify([{ id: 'l1', title: 'local clip', updated_at: 9 }]));
      failing = true;
      await wait(800); // debounce + any retry timers
      const afterEdit = { last: statuses[statuses.length - 1], pushes: pushes.length, synced: statuses.includes('synced') };
      // Next realtime event retries the apply, now succeeding.
      failing = false;
      realtime({ new: { data: remote, updated_at: 't1' } });
      await wait(800);
      resolve({ afterInit, afterEdit, final: statuses[statuses.length - 1], pushes: pushes.slice(), realtimeSeen: !!realtime });
    })();
  });
}

(async () => {
  const bad = await run(true);
  if (bad.errors.length !== 1) fail(`expected exactly one console.error, saw ${bad.errors.length}`);
  if (!/^hype sync: could not apply remote state for hype_audio/.test(String(bad.errors[0][0]))) fail('console.error message text wrong: ' + bad.errors[0][0]);
  if (!(bad.errors[0][1] instanceof Error) && !(bad.errors[0][1] && bad.errors[0][1].message)) fail('console.error should receive the error object');
  if (bad.statuses[bad.statuses.length - 1] !== 'retrying') fail(`a failed apply should end retrying (saw: ${bad.statuses.join(',')})`);

  const good = await run(false);
  if (good.errors.length !== 0) fail(`a normal apply must not console.error (saw ${good.errors.length})`);
  if (good.statuses.includes('retrying')) fail(`a normal apply must not show retrying (saw: ${good.statuses.join(',')})`);
  if (good.statuses[good.statuses.length - 1] !== 'synced') fail(`a normal apply should end synced (saw: ${good.statuses.join(',')})`);

  const rec = await runRecovery();
  if (!rec.realtimeSeen) fail('realtime handler was not registered');
  if (rec.afterInit.last !== 'retrying') fail('failed init apply should show retrying (saw ' + rec.afterInit.last + ')');
  if (rec.afterEdit.pushes !== 0) fail('no push may be sent while applyFailed is true (saw ' + rec.afterEdit.pushes + ')');
  if (rec.afterEdit.last !== 'retrying' || rec.afterEdit.synced) fail('a local edit during a failed apply must keep retrying, not synced (saw last=' + rec.afterEdit.last + ')');
  if (rec.final !== 'synced') fail('a later successful apply should clear applyFailed and end synced (saw ' + rec.final + ')');
  if (rec.pushes.length !== 1) fail('pushing should resume after a successful apply (saw ' + rec.pushes.length + ' pushes)');
  const sent = JSON.stringify(rec.pushes[0].data);
  if (sent.indexOf('r1') === -1 || sent.indexOf('l1') === -1) fail('the resumed push should carry the merged remote+local state: ' + sent);

  console.log('sync-apply-failure.selfcheck.js: all assertions passed');
  process.exit(0);
})();

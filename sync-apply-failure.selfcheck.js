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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Failed inbound apply -> no push, stays retrying -> later successful apply clears it and pushing resumes.
async function runRecovery() {
  const statuses = [];
  const writes = [];
  let failApply = true;
  let realtimeCb = null;
  const store = { hype_audio: JSON.stringify([{ id: 'l1', title: 'local clip', updated_at: 1 }]) };
  const remote1 = { hype_audio: [{ id: 'r1', title: 'remote clip', updated_at: 5 }] };
  const remote2 = { hype_audio: [{ id: 'r1', title: 'remote clip v2', updated_at: 9 }] };
  const fakeSupa = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { data: remote1, updated_at: 't1' }, error: null }) }) }),
      update: (row) => { writes.push(row); return { eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ updated_at: row.updated_at }], error: null }) }) }) }; },
      insert: (row) => { writes.push(row); return { select: () => Promise.resolve({ data: [{ updated_at: row.updated_at }], error: null }) }; },
    }),
    channel: () => ({ on(t, f, cb) { realtimeCb = cb; return this; }, subscribe() { return this; } }),
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
      // Only the incoming remote value fails to write; local edits (no 'remote clip') succeed.
      setItem: (k, v) => { if (failApply && String(v).includes('remote clip')) throw new Error('QuotaExceededError'); store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    console: { error() {}, log() {}, warn() {} },
    setTimeout, clearTimeout, JSON, Date, Object, Array, Promise, Map, String, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(casSource, sandbox);
  vm.runInContext(source, sandbox);
  sandbox.window.initCloudSync({ appKey: 'hype-audio', syncedKeys: ['hype_audio'], onStatusChange: (s) => statuses.push(s) });

  await sleep(800); // init read; apply fails; any (wrongly) scheduled push would have fired by now
  if (statuses[statuses.length - 1] !== 'retrying') fail(`failed init apply should be retrying (saw: ${statuses.join(',')})`);
  if (writes.length !== 0) fail(`no push may be sent while applyFailed (init), saw ${writes.length}`);

  // A local edit while the apply is still failing must not push the stale local copy.
  sandbox.localStorage.setItem('hype_audio', JSON.stringify([{ id: 'l1', title: 'edited', updated_at: 2 }]));
  await sleep(800);
  if (writes.length !== 0) fail(`no push may be sent while applyFailed (local edit), saw ${writes.length}`);
  if (statuses.includes('synced')) fail(`status must not report synced while the remote apply is failing (saw: ${statuses.join(',')})`);
  if (statuses[statuses.length - 1] !== 'retrying') fail(`should still be retrying (saw: ${statuses.join(',')})`);

  // Next realtime event: apply still failing -> still retrying, still no push.
  realtimeCb({ new: { data: remote1, updated_at: 't1' } });
  await sleep(500);
  if (writes.length !== 0 || statuses[statuses.length - 1] !== 'retrying') fail('a repeated failing apply must keep retrying and not push');

  // Store recovers; the next realtime event applies, clears applyFailed, and pushing resumes.
  failApply = false;
  realtimeCb({ new: { data: remote2, updated_at: 't2' } });
  await sleep(900);
  if (!/remote clip v2/.test(store.hype_audio)) fail('a later successful apply should write the remote value');
  if (writes.length < 1) fail('pushing should resume after a successful apply');
  if (statuses[statuses.length - 1] !== 'synced') fail(`should end synced after recovery (saw: ${statuses.join(',')})`);
}

(async () => {
  await runRecovery();
  const bad = await run(true);
  if (bad.errors.length !== 1) fail(`expected exactly one console.error, saw ${bad.errors.length}`);
  if (!/^hype sync: could not apply remote state for hype_audio/.test(String(bad.errors[0][0]))) fail('console.error message text wrong: ' + bad.errors[0][0]);
  if (!(bad.errors[0][1] instanceof Error) && !(bad.errors[0][1] && bad.errors[0][1].message)) fail('console.error should receive the error object');
  if (bad.statuses[bad.statuses.length - 1] !== 'retrying') fail(`a failed apply should end retrying (saw: ${bad.statuses.join(',')})`);

  const good = await run(false);
  if (good.errors.length !== 0) fail(`a normal apply must not console.error (saw ${good.errors.length})`);
  if (good.statuses.includes('retrying')) fail(`a normal apply must not show retrying (saw: ${good.statuses.join(',')})`);
  if (good.statuses[good.statuses.length - 1] !== 'synced') fail(`a normal apply should end synced (saw: ${good.statuses.join(',')})`);

  console.log('sync-apply-failure.selfcheck.js: all assertions passed');
  process.exit(0);
})();

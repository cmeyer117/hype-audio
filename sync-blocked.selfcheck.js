// Run with: node sync-blocked.selfcheck.js
// End-to-end guard for the 2026-09-30 finding: writes to app_state key 'hype-audio'
// were RLS-denied (Postgres 42501) for 8+ days after the 2026-09-22 anon-policy
// tightening, and the indicator only ever said "Retrying...". Drives the REAL
// initCloudSync (sync.js) against a fake Supabase client and asserts the status
// callback reaches 'blocked' on a permission denial, and returns to 'synced' once
// a write succeeds.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

function run(upsertResult) {
  return new Promise((resolve) => {
    const statuses = [];
    const store = { hype_audio: JSON.stringify([{ id: 'c1', title: 'a clip', updated_at: 1 }]) };
    const upserts = [];
    const fakeSupa = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        upsert: (row) => { upserts.push(row); return Promise.resolve(upsertResult()); },
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
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      console, setTimeout, clearTimeout, JSON, Date, Object, Array, Promise,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    sandbox.window.initCloudSync({
      appKey: 'hype-audio',
      syncedKeys: ['hype_audio', 'hype_audio_events'],
      onStatusChange: (status) => statuses.push(status),
    });
    // init round-trip + 250ms debounce + first upsert attempt
    setTimeout(() => resolve({ statuses, upserts: upserts.length }), 900);
  });
}

(async () => {
  // 1. RLS denial (what the live database returns to anon) -> 'blocked', never just 'retrying'.
  const denied = await run(() => ({ error: { code: '42501', message: 'new row violates row-level security policy for table "app_state"' } }));
  if (denied.upserts < 1) fail('the push was never attempted');
  if (!denied.statuses.includes('blocked')) fail(`a permission denial never reached "blocked" (saw: ${denied.statuses.join(',')})`);
  if (denied.statuses[denied.statuses.length - 1] !== 'blocked') fail(`final status after a denial should be blocked (saw: ${denied.statuses.join(',')})`);

  // 1b. supabase-js v2 puts the HTTP status on the result object, NOT on the error: a
  // revoked key's 401 with a generic error message must still reach 'blocked'.
  const denied401 = await run(() => ({ error: { message: 'something went wrong' }, status: 401 }));
  if (!denied401.statuses.includes('blocked')) fail(`a 401 on the response object never reached "blocked" (saw: ${denied401.statuses.join(',')})`);

  // 2. A transient failure stays 'retrying' -- it must NOT be flagged as a permission problem.
  const transient = await run(() => ({ error: { message: 'Failed to fetch' } }));
  if (transient.statuses.includes('blocked')) fail(`a network failure was wrongly flagged blocked (saw: ${transient.statuses.join(',')})`);
  if (!transient.statuses.includes('retrying')) fail(`a network failure should show retrying (saw: ${transient.statuses.join(',')})`);

  // 3. A working write ends 'synced'.
  const ok = await run(() => ({ error: null }));
  if (ok.statuses[ok.statuses.length - 1] !== 'synced') fail(`a successful write should end synced (saw: ${ok.statuses.join(',')})`);
  if (ok.statuses.includes('blocked')) fail('a successful write must never show blocked');

  console.log('sync-blocked.selfcheck.js: all assertions passed');
  process.exit(0);
})();

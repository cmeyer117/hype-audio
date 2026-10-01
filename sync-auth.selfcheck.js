// Run with: node sync-auth.selfcheck.js
// Drives the REAL initCloudSync (sync.js) with a fake HypeAuth + fake Supabase client:
//  - signed out  -> 'signedout', and NOTHING is read from or written to the cloud
//  - offline     -> 'offline' (not a sign-in nag)
//  - signs in    -> sync starts without a reload and reaches 'synced'; realtime subscribed once
//  - unload flush -> the raw fetch carries the OWNER token, never the anon key
//  - signs out   -> pushes stop and it returns to 'signedout'
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');
function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function build(initialAuth, opts) {
  opts = opts || {};
  const statuses = [];
  const store = { hype_audio: JSON.stringify([{ id: 'c1', title: 'a clip', updated_at: 1 }]) };
  const cloud = { selects: 0, upserts: 0, channels: 0 };
  const fetches = [];
  const events = {};
  const doc = { visibilityState: 'visible', handler: null, addEventListener(evt, cb) { if (evt === 'visibilitychange') this.handler = cb; } };
  let authState = initialAuth;                 // 'owner' | 'signedout' | 'unknown'
  let token = null;
  const listeners = [];
  const fakeSupa = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => {
        cloud.selects++;
        // opts.selectDelay simulates a slow initial read so a sign-out can land while it is in flight.
        const remote = { data: opts.remoteData || null, error: opts.readError || null };
        return opts.selectDelay ? new Promise((r) => setTimeout(() => r(remote), opts.selectDelay)) : Promise.resolve(remote);
      } }) }),
      upsert: () => { cloud.upserts++; return Promise.resolve({ error: null }); },
    }),
    channel: () => { cloud.channels++; return { on() { return this; }, subscribe() { return this; } }; },
  };
  const HypeAuth = {
    getClient: () => fakeSupa,
    status: () => Promise.resolve(authState),
    accessToken: () => token,
    onChange: (cb) => listeners.push(cb),
  };
  const sandbox = {
    window: {
      supabase: { createClient: () => fakeSupa },
      SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'ANON-KEY' },
      addEventListener(evt, cb) { events[evt] = cb; },
      HypeAuth,
    },
    document: doc,
    localStorage: {
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i],
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: (url, opts) => { fetches.push({ url, opts }); return Promise.resolve({ ok: true, status: 200 }); },
    console, setTimeout, clearTimeout, JSON, Date, Object, Array, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  sandbox.window.initCloudSync({ appKey: 'hype-audio', syncedKeys: ['hype_audio', 'hype_audio_events'], onStatusChange: (s) => statuses.push(s) });
  return {
    statuses, cloud, fetches, store, doc, events,
    setAuth: (state, tok) => { authState = state; token = tok || null; },
    fire: (session) => listeners.forEach((cb) => cb(session)),
  };
}

(async () => {
  // 1. Signed out: local only, nothing touches the cloud.
  {
    const t = build('signedout');
    await sleep(600);
    if (!t.statuses.includes('signedout')) fail(`signed out never showed "signedout" (saw: ${t.statuses.join(',')})`);
    if (t.cloud.selects || t.cloud.upserts || t.cloud.channels) fail(`signed out must not touch the cloud (selects=${t.cloud.selects}, upserts=${t.cloud.upserts}, channels=${t.cloud.channels})`);
  }

  // 2. Offline (auth server unreachable): 'offline', not a sign-in prompt.
  {
    const t = build('unknown');
    await sleep(400);
    if (!t.statuses.includes('offline') || t.statuses.includes('signedout')) fail(`unreachable auth should read offline, not signedout (saw: ${t.statuses.join(',')})`);
    t.setAuth('owner', 'OWNER-JWT');
    if (!t.events.online) fail('failed initialization must register network recovery');
    t.events.online();
    await sleep(400);
    if (t.statuses.at(-1) !== 'synced') fail('network recovery must clear offline and synchronize without an auth event');
    const reads = t.cloud.selects;
    t.events.online();
    await sleep(50);
    if (t.cloud.selects !== reads) fail('already-ready sync must not restart on every online event');
  }

  // 3-5. Signs in later, flushes with the owner token, signs out.
  {
    const opts = { readError: { message: 'temporary read failure' } };
    const t = build('owner', opts);
    await sleep(100);
    if (t.cloud.upserts !== 0 || t.statuses.at(-1) !== 'offline') fail('failed read must stay offline without writing');
    opts.readError = null;
    t.doc.visibilityState = 'visible';
    t.doc.handler();
    await sleep(400);
    if (t.statuses.at(-1) !== 'synced' || t.cloud.selects !== 2) fail('foreground recovery must retry the failed cloud read and clear offline');
  }

  {
    const t = build('signedout');
    await sleep(400);
    t.setAuth('owner', 'OWNER-JWT');
    t.fire({ access_token: 'OWNER-JWT' });
    t.fire({ access_token: 'OWNER-JWT' });      // a duplicate auth event must not double-init
    await sleep(900);
    if (t.statuses[t.statuses.length - 1] !== 'synced') fail(`after sign-in the last status should be synced (saw: ${t.statuses.join(',')})`);
    if (t.cloud.upserts < 1) fail('after sign-in the local library was never pushed');
    if (t.cloud.channels !== 1) fail(`the realtime channel must be subscribed exactly once (was ${t.cloud.channels})`);

    // 4. Unload flush carries the owner token, not the anon key.
    t.store.hype_audio = JSON.stringify([{ id: 'c1', title: 'edited', updated_at: 2 }]);
    if (typeof t.doc.handler !== 'function') fail('sync.js registered no visibilitychange handler');
    t.doc.visibilityState = 'hidden';
    t.doc.handler();
    if (t.fetches.length !== 1) fail(`the unload flush should make exactly one raw fetch (made ${t.fetches.length})`);
    const auth = t.fetches[0].opts.headers.Authorization;
    if (auth !== 'Bearer OWNER-JWT') fail(`the unload flush must use the owner token, got: ${auth}`);
    if (auth.includes('ANON-KEY')) fail('the unload flush leaked the anon key as the bearer');
    if (t.fetches[0].opts.headers.apikey !== 'ANON-KEY') fail('the apikey header (project key) must still be sent');

    // 5. Signing out stops pushes and returns to signedout.
    t.setAuth('signedout');
    t.fire(null);
    const upsertsBefore = t.cloud.upserts;
    t.store.hype_audio = JSON.stringify([{ id: 'c1', title: 'edited again', updated_at: 3 }]);
    t.doc.visibilityState = 'visible';
    await sleep(500);
    if (t.statuses[t.statuses.length - 1] !== 'signedout') fail(`after sign-out the last status should be signedout (saw: ${t.statuses.join(',')})`);
    if (t.cloud.upserts !== upsertsBefore) fail('a signed-out session must not push');
    t.fetches.length = 0;
    t.doc.visibilityState = 'hidden';
    t.doc.handler();
    if (t.fetches.length !== 0) fail('a signed-out session must not flush on unload');
  }

  // 6. RACE (Codex review 2026-09-30): signing out while the initial cloud read is still in
  //    flight must NOT be undone when that read returns -- no syncReady, no remote applied over
  //    local data, no pushes, no realtime subscription.
  {
    const remote = { hype_audio: JSON.stringify([{ id: 'remote-only', title: 'from cloud', updated_at: 9 }]) };
    const t = build('owner', { selectDelay: 400, remoteData: remote });
    t.setAuth('owner', 'OWNER-JWT');
    await sleep(100);                       // init is now awaiting the slow SELECT
    t.setAuth('signedout');
    t.fire(null);                           // SIGNED_OUT arrives mid-read
    await sleep(700);                       // the SELECT returns after the sign-out
    if (t.statuses[t.statuses.length - 1] !== 'signedout') fail(`a sign-out during the initial read must stay signedout (saw: ${t.statuses.join(',')})`);
    if (t.statuses.includes('synced')) fail(`a stale init flipped a signed-out session to synced (saw: ${t.statuses.join(',')})`);
    if (t.store.hype_audio.includes('remote-only')) fail('a stale init applied remote data over local after sign-out');
    if (t.cloud.upserts !== 0) fail('a stale init pushed after sign-out');
    if (t.cloud.channels !== 0) fail('a stale init subscribed realtime after sign-out');
  }

  // 7. The unload flush must decline (not fall back to the anon key) when there is no owner token,
  //    even if syncReady is somehow still true.
  {
    const t = build('owner');
    t.setAuth('owner', 'OWNER-JWT');
    await sleep(700);
    if (t.statuses[t.statuses.length - 1] !== 'synced') fail(`setup: expected synced (saw: ${t.statuses.join(',')})`);
    t.setAuth('owner', null);               // token gone, but no SIGNED_OUT event yet (inconsistent state)
    t.store.hype_audio = JSON.stringify([{ id: 'c1', title: 'changed', updated_at: 5 }]);
    t.doc.visibilityState = 'hidden';
    t.doc.handler();
    if (t.fetches.length !== 0) fail(`a flush with no owner token must not fetch at all (fetched with ${t.fetches[0] && t.fetches[0].opts.headers.Authorization})`);
  }

  console.log('sync-auth.selfcheck.js: all assertions passed');
  process.exit(0);
})();

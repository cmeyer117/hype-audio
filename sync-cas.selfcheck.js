// Run with: node sync-cas.selfcheck.js
// Acceptance test for the 2026-10-03 Codex audit P1 (Hype): sync.js pushed the whole library with an
// unconditional upsert, so a favorite/upload/event another device wrote between this device's read and write
// was overwritten before its realtime event applied. Drives the REAL sync.js against a versioned fake cloud
// whose `upsert` throws, so the old code path fails here. A conflict must pull, merge and retry, keeping both.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');
const casSource = fs.readFileSync(path.join(__dirname, 'hype-cas-write.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

function build() {
  const store = { hype_audio: JSON.stringify([{ id: 'c1', title: 'one', updated_at: 1 }]) };
  let n = 1;
  const cloud = { row: { data: { hype_audio: [{ id: 'c1', title: 'one', updated_at: 1 }] }, updated_at: 'v1' }, conflicts: 0, writes: 0, flushes: [] };
  const bump = (data) => { n++; cloud.row = { data, updated_at: 'v' + n }; return cloud.row.updated_at; };
  cloud.bump = bump;
  const fakeSupa = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...cloud.row, data: JSON.parse(JSON.stringify(cloud.row.data)) }, error: null }) }) }),
      upsert: () => { throw new Error('blind upsert must not be used'); },
      insert: () => ({ select: () => Promise.resolve({ data: null, error: { code: '23505' } }) }),
      update: (row) => {
        const preds = {};
        const chain = {
          eq: (c, v) => { preds[c] = v; return chain; },
          select: () => {
            if (cloud.row.updated_at !== preds.updated_at) { cloud.conflicts++; return Promise.resolve({ data: [], error: null }); }
            cloud.writes++;
            return Promise.resolve({ data: [{ updated_at: bump(row.data) }], error: null });
          },
        };
        return chain;
      },
    }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  };
  const events = {};
  const sandbox = {
    window: {
      supabase: { createClient: () => fakeSupa },
      SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'ANON-KEY' },
      addEventListener(evt, cb) { events[evt] = cb; },
    },
    document: { addEventListener() {}, visibilityState: 'visible' },
    localStorage: {
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i],
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: (url, opts) => { cloud.flushes.push({ url, opts }); return Promise.resolve({ ok: true, status: 204 }); },
    console, setTimeout, clearTimeout, JSON, Date, Object, Array, Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(casSource, sandbox);
  vm.runInContext(source, sandbox);
  sandbox.window.initCloudSync({ appKey: 'hype-audio', syncedKeys: ['hype_audio'], onStatusChange: () => {} });
  return { cloud, store, sandbox, events };
}

(async () => {
  // 1. Two writers: another device adds c3 after our initial read; then we favorite c1 locally. Our push holds
  // a stale token, conflicts, pulls c3, merges, retries -- the cloud ends with c1 (favorited) and c3.
  let t = build();
  await sleep(100); // initial read round-trips
  t.cloud.bump({ hype_audio: [{ id: 'c1', title: 'one', updated_at: 1 }, { id: 'c3', title: 'three', updated_at: 5 }] });
  t.sandbox.localStorage.setItem('hype_audio', JSON.stringify([{ id: 'c1', title: 'one', fav: true, updated_at: 9 }]));
  await sleep(900);
  const ids = (t.cloud.row.data.hype_audio || []).map((e) => e.id).sort();
  if (t.cloud.conflicts < 1) fail('the stale write was never detected as a conflict');
  if (ids.join() !== 'c1,c3') fail(`both writers' clips must survive, cloud has: ${ids.join()}`);
  const c1 = t.cloud.row.data.hype_audio.find((e) => e.id === 'c1');
  if (!c1 || !c1.fav) fail('our local favorite did not reach the cloud after the merge retry');

  // 2. A stale unload flush must not overwrite a newer cloud version: it is a conditional PATCH, never merge-duplicates.
  t = build();
  await sleep(100);
  t.sandbox.window.HypeAuth = undefined;
  t.sandbox.localStorage.setItem('hype_audio', JSON.stringify([{ id: 'c1', title: 'one', fav: true, updated_at: 9 }]));
  t.events.beforeunload && t.events.beforeunload();
  await sleep(50);
  const f = t.cloud.flushes[0];
  if (!f) fail('the unload flush made no request');
  if (f.opts.method !== 'PATCH' || !/updated_at=eq\.v1/.test(f.url)) fail(`unload must be a conditional PATCH on the last-seen version (got ${f.opts.method} ${f.url})`);
  if (/merge-duplicates/.test(f.opts.headers.Prefer)) fail('unload must never merge-duplicates');

  console.log('sync-cas.selfcheck.js: all assertions passed');
  process.exit(0);
})();

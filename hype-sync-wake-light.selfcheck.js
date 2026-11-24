// Run with: node hype-sync-wake-light.selfcheck.js
// Coming back to the foreground asks for updated_at alone and only downloads the whole row (about 700 KB) when another device moved it.
// Drives the REAL initCloudSync (sync.js) with a fake HypeAuth and a fake Supabase client that counts light and full reads.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');
function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let now = 1_000_000;
const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
const cloud = { light: 0, full: 0, version: 'v1' };
const store = { hype_audio: JSON.stringify([{ id: 'c1', title: 'a clip', updated_at: 1 }]) };
const doc = { visibilityState: 'visible', handler: null, addEventListener(evt, cb) { if (evt === 'visibilitychange') this.handler = cb; } };
const row = () => ({ data: { hype_audio: [{ id: 'c1', title: 'a clip', updated_at: 1 }] }, updated_at: cloud.version });
const fakeSupa = {
  from: () => ({
    select: (cols) => ({ eq: () => ({ maybeSingle: () => {
      if (String(cols).replace(/\s/g, '') === 'updated_at') { cloud.light++; return Promise.resolve({ data: { updated_at: cloud.version }, error: null }); }
      cloud.full++; return Promise.resolve({ data: row(), error: null });
    } }) }),
    insert: () => ({ select: () => Promise.resolve({ data: [{ updated_at: 'v9' }], error: null }) }),
    update: () => { const c = { eq: () => c, select: () => Promise.resolve({ data: [{ updated_at: 'v9' }], error: null }) }; return c; },
  }),
};
const sandbox = {
  window: {
    supabase: { createClient: () => fakeSupa }, SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'ANON-KEY' }, addEventListener() {},
    HypeAuth: { getClient: () => fakeSupa, status: () => Promise.resolve('owner'), accessToken: () => 'OWNER-JWT', onChange() {} },
  },
  document: doc,
  localStorage: {
    get length() { return Object.keys(store).length; }, key: (i) => Object.keys(store)[i],
    getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
  },
  fetch: () => Promise.resolve({ ok: true, status: 200 }),
  console, setTimeout, clearTimeout, JSON, Date: FakeDate, Object, Array, Promise,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'hype-cas-write.js'), 'utf8'), sandbox);
vm.runInContext(source, sandbox);
sandbox.window.initCloudSync({ appKey: 'hype-audio', syncedKeys: ['hype_audio', 'hype_audio_events'] });

(async () => {
  await sleep(300);
  if (cloud.full !== 1) fail(`the first load reads the row once (full=${cloud.full})`);

  now += 3 * 60 * 1000; // past the 2-minute wake throttle
  doc.visibilityState = 'visible'; doc.handler();
  await sleep(100);
  if (cloud.light !== 1 || cloud.full !== 1) fail(`an unchanged row costs one light read and no download (light=${cloud.light}, full=${cloud.full})`);

  cloud.version = 'v2'; // another device wrote
  now += 3 * 60 * 1000;
  doc.handler();
  await sleep(300);
  if (cloud.light !== 2 || cloud.full !== 2) fail(`a moved row is downloaded after the light read (light=${cloud.light}, full=${cloud.full})`);

  console.log('hype-sync-wake-light: unchanged row = light read only; moved row = full pull');
  process.exit(0);
})();

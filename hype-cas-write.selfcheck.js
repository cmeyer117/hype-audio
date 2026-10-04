// Run with: node hype-cas-write.selfcheck.cjs
// Regression for the 2026-10-03 Codex audit P1: sync.js pushed the whole shared row with an unconditional
// upsert, so a writer landing between our read and our write was silently dropped. hype-cas-write.js makes
// the write a compare-and-swap on app_state.updated_at (same contract as vessel-sync.js, commit 1fd5fea).
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const sandbox = { window: {}, Date, Math };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'hype-cas-write.js'), 'utf8'), sandbox);
const CAS = sandbox.window.HypeCasWrite;

let failures = 0;
function check(cond, label) {
  if (!cond) { failures++; console.log('FAIL ' + label); } else console.log('ok   ' + label);
}

// Fake cloud holding one versioned row. `update` only matches when the predicate token equals the stored
// version (what PostgREST does); `insert` fails 23505 when a row exists. A blind upsert is deliberately absent
// from the fake, so the old code path would throw here rather than pass.
function makeCloud(initialData) {
  let v = 1;
  const cloud = {
    row: initialData ? { data: initialData, updated_at: '2026-10-03T10:00:00.000Z' } : null,
    writes: [],
    bump(data, stamp) { v++; cloud.row = { data, updated_at: stamp || ('2026-10-03T10:00:0' + v + '.000Z') }; },
  };
  cloud.supa = {
    from: () => ({
      insert: (row) => ({
        select: () => {
          cloud.writes.push('insert');
          if (cloud.row) return Promise.resolve({ data: null, error: { code: '23505' } });
          cloud.bump(row.data, row.updated_at);
          return Promise.resolve({ data: [{ updated_at: row.updated_at }], error: null });
        },
      }),
      update: (row) => {
        const preds = {};
        const chain = {
          eq: (c, val) => { preds[c] = val; return chain; },
          select: () => {
            cloud.writes.push('update');
            if (!cloud.row || cloud.row.updated_at !== preds.updated_at) return Promise.resolve({ data: [], error: null });
            cloud.bump(row.data, row.updated_at);
            return Promise.resolve({ data: [{ updated_at: row.updated_at }], error: null });
          },
        };
        return chain;
      },
    }),
  };
  return cloud;
}

(async () => {
  // nextStamp is strictly after the previous token even when the clock is behind or equal.
  const prev = '2026-10-03T10:00:00.500Z';
  check(CAS.nextStamp(prev, Date.parse(prev) - 5000) === '2026-10-03T10:00:00.501Z', 'nextStamp advances past a token ahead of the local clock');
  check(CAS.nextStamp(prev, Date.parse(prev)) === '2026-10-03T10:00:00.501Z', 'nextStamp advances when the clock equals the token');
  check(CAS.nextStamp(null, Date.parse('2026-10-03T12:00:00.000Z')) === '2026-10-03T12:00:00.000Z', 'nextStamp with no token is just now');

  // Happy path: matching token writes and returns the new version.
  let c = makeCloud({ a: 1 });
  let r = await CAS.casWrite(c.supa, 'k', { a: 1, b: 2 }, c.row.updated_at, Date.parse('2026-10-03T11:00:00.000Z'));
  check(r.status === 'ok' && c.row.data.b === 2 && r.token === c.row.updated_at, 'matching token writes and returns the new token');

  // Two writers: A and B both read version v1; A writes; B's write must NOT land (this is the lost-update).
  c = makeCloud({ a: 1 });
  const v1 = c.row.updated_at;
  const ra = await CAS.casWrite(c.supa, 'k', { a: 1, fromA: true }, v1, Date.parse('2026-10-03T11:00:00.000Z'));
  const rb = await CAS.casWrite(c.supa, 'k', { a: 1, fromB: true }, v1, Date.parse('2026-10-03T11:00:00.000Z'));
  check(ra.status === 'ok' && rb.status === 'conflict', 'second writer holding a stale token gets a conflict');
  check(c.row.data.fromA === true && !c.row.data.fromB, 'the first writer\'s data is not overwritten by the stale writer');
  // B pulls, merges, retries with the fresh token, and then both writes survive.
  const rb2 = await CAS.casWrite(c.supa, 'k', { a: 1, fromA: true, fromB: true }, ra.token, Date.parse('2026-10-03T11:00:01.000Z'));
  check(rb2.status === 'ok' && c.row.data.fromA && c.row.data.fromB, 'after merge and retry both writers\' changes survive');

  // First insert: no token means insert, never upsert; a row that appeared since our read is a conflict.
  c = makeCloud(null);
  r = await CAS.casWrite(c.supa, 'k', { a: 1 }, null, Date.parse('2026-10-03T11:00:00.000Z'));
  check(r.status === 'ok' && c.writes[0] === 'insert', 'no token inserts');
  c = makeCloud({ other: true });
  r = await CAS.casWrite(c.supa, 'k', { a: 1 }, null, Date.parse('2026-10-03T11:00:00.000Z'));
  check(r.status === 'conflict' && c.row.data.other === true, 'insert racing an existing row is a conflict and leaves it intact');

  // Errors are reported, never thrown or treated as success.
  const bad = { from: () => ({ update: () => ({ eq() { return this; }, select: () => Promise.resolve({ data: null, error: { code: '42501', message: 'rls' }, status: 403 }) }) }) };
  r = await CAS.casWrite(bad, 'k', {}, 'x', 0);
  check(r.status === 'error' && r.error.code === '42501' && r.httpStatus === 403, 'a database error is status error with the HTTP status (state stays dirty)');
  const boom = { from: () => { throw new Error('net'); } };
  r = await CAS.casWrite(boom, 'k', {}, 'x', 0);
  check(r.status === 'error', 'a thrown error is status error');

  // Unload: conditional PATCH with the encoded token; never a merge-duplicates upsert.
  const u = CAS.unloadRequest('https://x.supabase.co', 'po-coach', { a: 1 }, '2026-10-03T10:00:00.500+00:00', Date.parse('2026-10-03T11:00:00.000Z'));
  check(u.method === 'PATCH' && u.url === 'https://x.supabase.co/rest/v1/app_state?key=eq.po-coach&updated_at=eq.2026-10-03T10%3A00%3A00.500%2B00%3A00', 'unload with a token is a conditional PATCH with an encoded token');
  check(u.prefer === 'return=minimal' && !/merge-duplicates/.test(u.prefer), 'unload never asks to merge-duplicates');
  const u2 = CAS.unloadRequest('https://x.supabase.co', 'po-coach', { a: 1 }, null, 0);
  check(u2.method === 'POST' && u2.url === 'https://x.supabase.co/rest/v1/app_state' && !/merge-duplicates/.test(u2.prefer), 'unload with no token is a plain POST insert, no upsert');
  check(JSON.parse(u.body).key === 'po-coach' && JSON.parse(u.body).data.a === 1, 'unload body carries key and data');

  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('hype-cas-write selfcheck: all passed');
})();

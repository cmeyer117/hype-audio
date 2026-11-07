// Run with: node smoke-deploy.selfcheck.js
// scripts/smoke-deploy.js logic against a fake fetch (no network).
'use strict';
const assert = require('node:assert/strict');
const { smoke } = require('./scripts/smoke-deploy.js');

function fakeFetch(status, body) {
  const calls = [];
  const f = async function (url) { calls.push(url); return { status: status, json: async function () { return body; } }; };
  f.calls = calls;
  return f;
}

async function main() {
  const f = fakeFetch(200, { status: 'ok', commit: 'ba83f70abc' });
  assert.deepEqual(await smoke('https://x.invalid/', null, f), { status: 'ok', commit: 'ba83f70abc' });
  assert.equal(f.calls[0], 'https://x.invalid/api/health', 'trailing slash trimmed');
  await smoke('https://x.invalid', 'ba83f70', f);
  await assert.rejects(smoke('https://x.invalid', 'deadbee', f), /does not match/);
  await assert.rejects(smoke('https://x.invalid', null, fakeFetch(500, {})), /HTTP 500/);
  await assert.rejects(smoke('https://x.invalid', null, fakeFetch(200, { status: 'down', commit: 'a' })), /status/);
  await assert.rejects(smoke('https://x.invalid', null, fakeFetch(200, { status: 'ok' })), /commit/);
  const seen = []; // the health call is bounded: it carries an abort signal so a hung host cannot stall a deploy check
  await smoke('https://x.invalid', null, async function (_u, init) { seen.push(init && init.signal); return { status: 200, json: async function () { return { status: 'ok', commit: 'a' }; } }; });
  assert.ok(seen[0] && typeof seen[0].aborted === 'boolean', 'health fetch has an abort signal');
  console.log('PASS: smoke-deploy asserts status ok + commit');
}
main().catch(function (e) { console.error(e); process.exit(1); });

// Run with: node health.selfcheck.js
// /api/health: the deployed commit, so a post-deploy smoke check can tell which build is live (engineering-standard health item 8).
'use strict';

async function main() {
  const { default: handler } = await import('./api/health.mjs');
  const assert = require('node:assert/strict');

  function call() {
    const headers = {};
    const out = {};
    const res = {
      setHeader: function (k, v) { headers[k.toLowerCase()] = v; },
      status: function (code) { out.code = code; return res; },
      json: function (body) { out.body = body; },
    };
    handler({ method: 'GET' }, res);
    return { code: out.code, body: out.body, headers: headers };
  }

  const prior = process.env.VERCEL_GIT_COMMIT_SHA;

  process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def';
  const live = call();
  assert.equal(live.code, 200);
  assert.deepEqual(live.body, { status: 'ok', commit: 'abc123def' }, 'body is exactly status + commit');
  assert.equal(live.headers['cache-control'], 'no-store', 'a cached health check would report a stale build');

  delete process.env.VERCEL_GIT_COMMIT_SHA;
  assert.deepEqual(call().body, { status: 'ok', commit: 'unknown' }, 'no env -> unknown');

  if (prior !== undefined) process.env.VERCEL_GIT_COMMIT_SHA = prior;
  console.log('PASS: hype /api/health returns ok + commit with no-store');
}

main().catch(function (error) { console.error(error); process.exit(1); });

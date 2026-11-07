// Post-deploy smoke check: GET <base>/api/health and assert status "ok" plus a commit string.
// Usage: node scripts/smoke-deploy.js <base-url> [expected-commit-prefix]
//   or:  SMOKE_URL=https://... node scripts/smoke-deploy.js
// Exit 0 on pass, 1 on fail. Read-only; no secrets.
'use strict';

async function smoke(base, expectedCommit, fetchImpl) {
  const url = String(base).replace(/\/+$/, '') + '/api/health';
  const res = await (fetchImpl || fetch)(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (res.status !== 200) throw new Error('GET ' + url + ' returned HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('health status is ' + JSON.stringify(body.status) + ', expected "ok"');
  if (typeof body.commit !== 'string' || !body.commit) throw new Error('health has no commit string');
  if (expectedCommit && !body.commit.startsWith(expectedCommit)) {
    throw new Error('live commit ' + body.commit + ' does not match expected ' + expectedCommit);
  }
  return body;
}

module.exports = { smoke };

if (require.main === module) {
  const base = process.argv[2] || process.env.SMOKE_URL;
  if (!base) {
    console.error('Usage: node scripts/smoke-deploy.js <base-url> [expected-commit-prefix]');
    process.exit(1);
  }
  smoke(base, process.argv[3]).then(
    function (b) { console.log('PASS smoke: ' + base + ' status=ok commit=' + b.commit); },
    function (e) { console.error('FAIL smoke: ' + e.message); process.exit(1); }
  );
}

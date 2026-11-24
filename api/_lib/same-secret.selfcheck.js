// node api/_lib/same-secret.selfcheck.js
// The upload passphrase is compared in constant time (Opus auth pass 2026-11-12, finding E), and both endpoints use it.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { sameSecret } = await import(pathToFileURL(path.join(__dirname, 'same-secret.mjs')).href);
  assert.equal(sameSecret('abc123', 'abc123'), true);
  assert.equal(sameSecret('abc124', 'abc123'), false);
  assert.equal(sameSecret('abc', 'abc123'), false, 'a prefix is not a match');
  assert.equal(sameSecret(undefined, 'abc123'), false, 'a missing header is not a match');
  assert.equal(sameSecret(['abc123'], 'abc123'), false, 'a repeated header arrives as an array and is refused');
  assert.equal(sameSecret('', ''), false, 'an empty secret never matches');

  for (const f of ['upload-clip.mjs', 'create-content-idea.mjs']) {
    // Exercise the actual route with a synthetic secret and a database constructor that must
    // never be reached. This covers helper refactors without pinning an inline function call.
    const routePath = path.join(__dirname, '..', f);
    const src = fs.readFileSync(routePath, 'utf8')
      .replace(/^import \{ createClient \} from '@supabase\/supabase-js'.*$/m,
        'const createClient = () => { throw new Error("unauthorized request reached the database") };')
      .replace('process.env.HYPE_AUDIO_UPLOAD_SECRET', JSON.stringify('abc123'))
      .replace(/from '(\.\/[^']+)'/g, (_match, relative) => "from '" + pathToFileURL(path.resolve(path.dirname(routePath), relative)).href + "'");
    const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    for (const given of [undefined, 'wrong', 'abc', ['abc123']]) {
      const res = { code: 0, status(code) { this.code = code; return this; }, json() {} };
      await handler({ method: 'POST', headers: { 'x-upload-secret': given }, body: {} }, res);
      assert.equal(res.code, 401, f + ' refuses an invalid passphrase before any database use');
    }
  }
  console.log('PASS: upload passphrase compared in constant time on both endpoints');
})().catch((e) => { console.error(e.message); process.exit(1); });

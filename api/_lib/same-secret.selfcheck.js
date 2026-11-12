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
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, /sameSecret\(req\.headers\['x-upload-secret'\], secret\)/, `${f} must use sameSecret`);
    assert.doesNotMatch(src, /\['x-upload-secret'\] !== secret/, `${f} still compares with !==`);
  }
  console.log('PASS: upload passphrase compared in constant time on both endpoints');
})().catch((e) => { console.error(e.message); process.exit(1); });

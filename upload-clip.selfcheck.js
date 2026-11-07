// Run with: node upload-clip.selfcheck.js
// /api/upload-clip is the only gate for writes into the hype-audio Storage bucket, so pin its current behaviour:
// method, shared-secret, input validation, filename sanitising, and the 502 paths. The supabase client is
// replaced with a fake (source is loaded with its import swapped), so nothing touches Storage or the network.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

async function main() {
  let src = fs.readFileSync(path.join(__dirname, 'api', 'upload-clip.mjs'), 'utf8');
  const importLine = /^import \{ createClient \} from '@supabase\/supabase-js'.*$/m;
  assert.ok(importLine.test(src), 'expected supabase import line');
  src = src.replace(importLine, 'const createClient = globalThis.__fakeCreateClient;');

  let fake;
  globalThis.__fakeCreateClient = function (url, key) {
    fake.created.push([url, key]);
    return {
      storage: {
        from: function (bucket) {
          fake.buckets.push(bucket);
          return {
            createSignedUploadUrl: async function (name) { fake.names.push(name); return fake.signed; },
            getPublicUrl: function (name) { return { data: fake.pub(name) }; },
          };
        },
      },
    };
  };
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const handler = mod.default;
  function reset() {
    fake = {
      created: [], buckets: [], names: [],
      signed: { data: { signedUrl: 'https://signed.invalid/up' }, error: null },
      pub: function (n) { return { publicUrl: 'https://pub.invalid/' + n }; },
    };
  }

  async function call(method, headers, body) {
    const out = {};
    const res = { status: function (c) { out.code = c; return res; }, json: function (b) { out.body = b; } };
    await handler({ method: method, headers: headers || {}, body: body }, res);
    return out;
  }

  const priorSecret = process.env.HYPE_AUDIO_UPLOAD_SECRET;
  const priorKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origError = console.error;
  console.error = function () {};
  const good = { filename: 'My Clip (1).mp3', contentType: 'audio/mpeg' };
  const auth = { 'x-upload-secret': 'selfcheck-secret' };

  try {
    reset();
    process.env.HYPE_AUDIO_UPLOAD_SECRET = 'selfcheck-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    assert.equal((await call('GET', auth, good)).code, 405, 'non-POST rejected');

    delete process.env.HYPE_AUDIO_UPLOAD_SECRET;
    assert.equal((await call('POST', auth, good)).code, 500, 'no server secret -> 500, never open');
    process.env.HYPE_AUDIO_UPLOAD_SECRET = 'selfcheck-secret';

    assert.equal((await call('POST', {}, good)).code, 401, 'missing header -> 401');
    assert.equal((await call('POST', { 'x-upload-secret': 'nope' }, good)).code, 401, 'wrong secret -> 401');
    assert.equal(fake.created.length, 0, 'no Storage client is created before auth passes');

    assert.equal((await call('POST', auth, undefined)).code, 400, 'no body -> 400');
    assert.equal((await call('POST', auth, { filename: '', contentType: 'audio/mpeg' })).code, 400, 'empty filename');
    assert.equal((await call('POST', auth, { filename: 'a'.repeat(201), contentType: 'audio/mpeg' })).code, 400, 'filename over 200');
    assert.equal((await call('POST', auth, { filename: 'a.png', contentType: 'image/png' })).code, 400, 'non-audio type');
    assert.equal((await call('POST', auth, { filename: 'a.mp3' })).code, 400, 'missing type');
    assert.equal(fake.created.length, 0, 'validation failures never reach Storage');

    const ok = await call('POST', auth, good);
    assert.equal(ok.code, 200);
    assert.equal(ok.body.uploadUrl, 'https://signed.invalid/up');
    assert.match(ok.body.publicUrl, /^https:\/\/pub\.invalid\/clip_\d+_[a-z0-9]+_My_Clip__1_\.mp3$/, 'name is prefixed and sanitised');
    assert.deepEqual(fake.buckets, ['hype-audio', 'hype-audio'], 'only the hype-audio bucket');
    assert.equal(fake.created[0][0], 'https://vikpcejlyxieguorwysf.supabase.co');
    assert.equal(fake.created[0][1], 'svc-key', 'service role key comes from env');

    reset();
    fake.signed = { data: null, error: { message: 'boom' } };
    assert.equal((await call('POST', auth, good)).code, 502, 'signed-url failure -> 502');
    reset();
    fake.pub = function () { return {}; };
    assert.equal((await call('POST', auth, good)).code, 502, 'no public url -> 502');
  } finally {
    console.error = origError;
    if (priorSecret === undefined) delete process.env.HYPE_AUDIO_UPLOAD_SECRET; else process.env.HYPE_AUDIO_UPLOAD_SECRET = priorSecret;
    if (priorKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = priorKey;
  }
  console.log('PASS: upload-clip auth, validation, sanitising and error paths');
}

main().catch(function (error) { console.error(error); process.exit(1); });

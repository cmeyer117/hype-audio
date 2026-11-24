const assert = require('node:assert/strict');
(async () => {
  const { createUploadGate } = await import('./upload-access.mjs');
  let now = 1000;
  const gate = createUploadGate({ maxAttempts: 2, windowMs: 1000, now: () => now });
  assert.equal(gate('wrong', 'secret'), 401);
  assert.equal(gate('secret', 'secret'), 200);
  assert.equal(gate('secret', 'secret'), 429, 'valid secrets do not bypass the request cap');
  now += 1001;
  assert.equal(gate('secret', 'secret'), 200);
  assert.equal(gate(undefined, undefined), 500);
  console.log('PASS upload gate bounds all attempts and expires the window');
})().catch(e => { console.error(e); process.exitCode = 1; });

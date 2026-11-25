// Run with: node sentry.selfcheck.js
// Hype failures reach Sentry (improve pass 2026-11-24, item 5b; copy of Vessel's reporter): the SDK ships from this origin, events go
// through /api/sentry-tunnel (Brave Shields blocks Sentry's own hosts), the tunnel relays only our project, and handled sync and upload
// failures are reported.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  const sdk = fs.readFileSync(path.join(__dirname, 'vendor/sentry.bundle.min.js'), 'latin1').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(sdk, 'latin1').digest('hex'), '2983539a1069f58a8ff2695273917c69790a979dac320d181eb050cb2c9ef369', 'the vendored Sentry bundle stays the pinned build');

  const html = read('index.html');
  const first = /<script src="vendor\/sentry\.bundle\.min\.js"><\/script>\s*<script src="hype-sentry\.js"><\/script>/.exec(html);
  assert.ok(first, 'index.html loads the SDK then hype-sentry.js');
  assert.equal(html.indexOf('<script'), first.index, 'and before every other script');

  const load = (Sentry, onLine = true) => {
    const sb = { window: Sentry ? { Sentry } : {}, location: { hostname: 'hype-audio-app.vercel.app' }, navigator: { onLine } };
    vm.createContext(sb);
    vm.runInContext(read('hype-sentry.js'), sb);
    return sb.window;
  };
  assert.doesNotThrow(() => load(null).HypeSentry.report(new Error('x'), 'a'));
  let cfg; const calls = [];
  const sentry = { init: (c) => { cfg = c; }, captureException: (e, ctx) => calls.push([e.message, ctx.tags.where]) };
  load(sentry).HypeSentry.report({ message: 'refused' }, 'sync:push');
  load(sentry, false).HypeSentry.report(new Error('offline'), 'sync:push');
  assert.deepEqual(calls, [['refused', 'sync:push']], 'reports once, and never while offline');
  assert.equal(cfg.tunnel, '/api/sentry-tunnel');
  assert.equal(cfg.initialScope.tags.app, 'hype-audio');
  assert.equal(cfg.environment, 'production');
  assert.equal(cfg.sendDefaultPii, false);

  const logic = await import(pathToFileURL(path.join(__dirname, 'api/_lib/sentry-tunnel-logic.mjs')));
  const envelope = (dsn) => Buffer.from(JSON.stringify({ dsn }) + '\n{}');
  assert.equal(logic.planForward(envelope(cfg.dsn)).ok, true, 'our own DSN is relayed');
  assert.equal(logic.planForward(envelope('https://k@o1.ingest.us.sentry.io/2')).status, 403);
  assert.equal(logic.planForward(Buffer.from('nope')).status, 400);
  assert.equal(logic.planForward(Buffer.alloc(logic.MAX_BODY_BYTES + 1)).status, 413);

  const { default: handler } = await import(pathToFileURL(path.join(__dirname, 'api/sentry-tunnel.mjs')));
  const call = async (method, body) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json() {}, end() {} };
    await handler({ method, async *[Symbol.asyncIterator]() { if (body) yield body; } }, res);
    return res.code;
  };
  assert.equal(await call('GET'), 405);
  const realFetch = global.fetch;
  global.fetch = async (url) => { assert.match(url, /ingest\.us\.sentry\.io\/api\/\d+\/envelope\/$/); return { status: 200 }; };
  assert.equal(await call('POST', envelope(cfg.dsn)), 200);
  global.fetch = async () => { throw new Error('down'); };
  assert.equal(await call('POST', envelope(cfg.dsn)), 502);
  global.fetch = realFetch;

  const sync = read('sync.js');
  assert.match(sync, /if \(!statusState\.retrying\) report\(error, 'sync:push'\);[^\n]*\n\s*statusState\.retrying = true;/, 'a push failure reports once per retry streak');
  assert.match(sync, /report\(e, 'sync:apply'\)/);
  assert.equal((read('hype-audio.js').match(/reportUpload\(/g) || []).length, 5, 'one helper, four upload failure paths');

  console.log('ok: Hype failures reach Sentry through this origin');
})().catch((e) => { console.error(e); process.exit(1); });

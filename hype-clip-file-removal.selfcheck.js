// Run with: node hype-clip-file-removal.selfcheck.js
// Verifies hypeRemoveClipFile (sync.js): deleting a clip also removes its audio file from the
// hype-audio Storage bucket, which the old tombstone-only delete never did (534 orphaned files,
// 460 MB, pushed the shared Supabase project over its 1 GB free quota on 2026-11-01).
// Guards: only this project's hype-audio bucket, never a file another active clip still uses,
// and only with the signed-in owner session (anon has no DELETE on storage).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');
const BASE = 'https://selfcheck.invalid/storage/v1/object/public/hype-audio/';

function fakeClient(session) {
  const removed = [];
  return {
    removed,
    auth: { getSession: async () => ({ data: { session } }) },
    storage: { from: (bucket) => ({ remove: async (names) => { removed.push([bucket, names]); return { data: names, error: null }; } }) },
  };
}

function load(client) {
  const sandbox = {
    window: {
      supabase: { createClient: () => { throw new Error('must use the HypeAuth owner client'); } },
      SUPABASE_CONFIG: { URL: 'https://selfcheck.invalid', KEY: 'selfcheck-key' },
      HypeAuth: client ? { getClient: () => client } : undefined,
    },
    console, setTimeout, clearTimeout, URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window;
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.exit(1); }
}

async function main() {
  const url = BASE + 'clip_1_abc_my%20rant.mp3';
  {
    const c = fakeClient({ user: { id: 'owner' } });
    const w = load(c);
    eq(typeof w.hypeRemoveClipFile, 'function', 'helper is exported');
    eq(await w.hypeRemoveClipFile(url, []), 'removed', 'signed-in delete removes the file');
    eq(c.removed, [['hype-audio', ['clip_1_abc_my rant.mp3']]], 'removes the decoded object name from hype-audio');
  }
  {
    const c = fakeClient({ user: { id: 'owner' } });
    const w = load(c);
    eq(await w.hypeRemoveClipFile(url, [{ id: '2', storage_url: url }]), 'in-use', 'another active clip still uses the file');
    eq(c.removed, [], 'in-use file is kept');
  }
  {
    const c = fakeClient({ user: { id: 'owner' } });
    const w = load(c);
    eq(await w.hypeRemoveClipFile('https://elsewhere.example/storage/v1/object/public/hype-audio/x.mp3', []), 'skip', 'foreign host skipped');
    eq(await w.hypeRemoveClipFile('https://selfcheck.invalid/storage/v1/object/public/progress-photos/x.jpg', []), 'skip', 'other bucket skipped');
    eq(await w.hypeRemoveClipFile(BASE + 'a/../../x.mp3', []), 'skip', 'path segments skipped');
    eq(await w.hypeRemoveClipFile(undefined, []), 'skip', 'missing url skipped');
    eq(c.removed, [], 'nothing removed for skipped urls');
  }
  {
    const c = fakeClient(null);
    const w = load(c);
    eq(await w.hypeRemoveClipFile(url, []), 'signed-out', 'no session, no removal');
    eq(c.removed, [], 'signed-out leaves the file for the weekly orphan guard');
    const w2 = load(null);
    eq(await w2.hypeRemoveClipFile(url, []), 'signed-out', 'no HypeAuth, no removal');
  }
  console.log('PASS: hype-clip-file-removal');
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });

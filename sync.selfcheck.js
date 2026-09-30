// Self-check for sync.js's mergeArrays — extracts the real function from the
// shipped file (not a re-implementation) and asserts the concurrent-write
// merge behavior that was the whole point of the fix.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8');
const match = src.match(/function mergeArrays\([\s\S]*?\n {4}\}/);
if (!match) { console.error('sync.selfcheck.js: mergeArrays not found in sync.js'); process.exit(1); }
const mergeArrays = new Function('return (' + match[0].replace('function mergeArrays', 'function') + ')')();

const retryMatch = src.match(/function nextRetryDelayMs\([\s\S]*?\n {4}\}/);
if (!retryMatch) { console.error('sync.selfcheck.js: nextRetryDelayMs not found in sync.js'); process.exit(1); }
const nextRetryDelayMs = new Function('return (' + retryMatch[0].replace('function nextRetryDelayMs', 'function') + ')')();

const statusMatch = src.match(/function computeSyncStatus\([\s\S]*?\n {4}\}/);
if (!statusMatch) { console.error('sync.selfcheck.js: computeSyncStatus not found in sync.js'); process.exit(1); }
const computeSyncStatus = new Function('return (' + statusMatch[0].replace('function computeSyncStatus', 'function') + ')')();

// flushOnUnload's keepalive-fetch success handler -- extracted (not
// reimplemented) so a regression here catches a real bug: this handler used
// to update lastSyncedJson/lastSyncedAt on a successful background push but
// never cleared statusState.retrying, leaving the owner-facing indicator
// stuck on "Retrying..." forever after a background flush actually synced.
const flushSuccessMatch = src.match(/if \(resp\.ok\) \{[^}]*\}/);
if (!flushSuccessMatch) { console.error('sync.selfcheck.js: flushOnUnload success handler not found in sync.js'); process.exit(1); }
const runFlushSuccess = new Function('json', 'statusState', 'updateStatus',
  'let lastSyncedJson, lastSyncedAt; const resp = { ok: true }; ' + flushSuccessMatch[0] + '; return { lastSyncedJson, lastSyncedAt };');

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); process.exit(1); }
}

// Concurrent-write case: remote has a new entry local doesn't, local has a new entry remote doesn't.
assertEqual(
  mergeArrays([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'c' }]),
  [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  'both sides keep their unique entries, no data loss'
);

// Same id on both sides: remote's copy wins, local's dup dropped.
assertEqual(
  mergeArrays([{ id: 'a', v: 'remote' }], [{ id: 'a', v: 'local' }]),
  [{ id: 'a', v: 'remote' }],
  'shared id dedupes to one entry'
);

// Primitives without an id field dedupe by value.
assertEqual(mergeArrays(['x', 'y'], ['y', 'z']), ['x', 'y', 'z'], 'primitive entries dedupe by value');

// Delete-resurrection regression: local just tombstoned an entry, but the
// incoming remote snapshot is stale and still has the non-tombstoned
// original (the delete hasn't round-tripped to remote yet). The tombstone
// must survive the merge, not get overwritten by the stale remote copy —
// otherwise a real delete gets silently undone by any device/tab still
// holding the old data.
assertEqual(
  mergeArrays([{ id: 'a' }], [{ id: 'a', deleted: true, deleted_at: 1 }]),
  [{ id: 'a', deleted: true, deleted_at: 1 }],
  'a local tombstone beats a stale non-deleted remote copy of the same id'
);

// A failed push retries a couple times with backoff (500ms, 1000ms), then
// gives up on immediate retries in favor of one longer-delay follow-up push
// -- confirms the loop actually terminates instead of retrying forever.
assertEqual(nextRetryDelayMs(0), 500, 'first retry waits 500ms');
assertEqual(nextRetryDelayMs(1), 1000, 'second retry waits 1000ms');
assertEqual(nextRetryDelayMs(2), null, 'third attempt gives up on immediate retry');

// Owner-visible sync status indicator: pure state->display mapping.
assertEqual(computeSyncStatus({ initFailed: false, pushInFlight: false, retrying: false }), 'synced', 'idle with no failures is synced');
assertEqual(computeSyncStatus({ initFailed: false, pushInFlight: true, retrying: false }), 'saving', 'a push in flight is saving');
assertEqual(computeSyncStatus({ initFailed: false, pushInFlight: false, retrying: true }), 'retrying', 'a failed push awaiting retry is retrying');
assertEqual(computeSyncStatus({ initFailed: true, pushInFlight: false, retrying: false }), 'offline', 'a failed init is offline');
// initFailed takes priority even if a stale push/retry flag is still set --
// there's no reconnect logic, so once init fails the app never recovers to
// try another push in the same session.
assertEqual(computeSyncStatus({ initFailed: true, pushInFlight: true, retrying: true }), 'offline', 'initFailed wins over other flags');

// Regression: a failed normal push sets retrying=true; a later successful
// background/hidden flushOnUnload keepalive must clear it, so the indicator
// reflects "synced" again instead of staying stuck on "Retrying...".
{
  const statusState = { initFailed: false, pushInFlight: false, retrying: true };
  runFlushSuccess('{"a":1}', statusState, () => {});
  assertEqual(computeSyncStatus(statusState), 'synced', 'a successful flushOnUnload after a failed push clears retrying');
}

// --- permanent permission failure gets its own visible state (2026-09-30) ---
// Writes to app_state key 'hype-audio' were RLS-denied for 8+ days after the
// 2026-09-22 anon-policy tightening and the indicator only ever said
// "Retrying...", which reads as transient. A permission denial is never fixed by
// retrying, so it must surface as 'blocked'.
const permMatch = src.match(/function isPermissionError\([\s\S]*?\n {4}\}/);
if (!permMatch) { console.error('sync.selfcheck.js: isPermissionError not found in sync.js'); process.exit(1); }
const isPermissionError = new Function('return (' + permMatch[0].replace('function isPermissionError', 'function') + ')')();

assertEqual(computeSyncStatus({ initFailed: false, pushInFlight: false, retrying: true, blocked: true }), 'blocked', 'a permission-denied push shows blocked, not retrying');
assertEqual(computeSyncStatus({ initFailed: false, pushInFlight: true, retrying: true, blocked: true }), 'saving', 'an attempt in flight still shows saving');
assertEqual(computeSyncStatus({ initFailed: true, pushInFlight: false, retrying: false, blocked: true }), 'offline', 'initFailed still wins over blocked');

for (const [err, expected, label] of [
  [{ code: '42501', message: 'new row violates row-level security policy for table "app_state"' }, true, 'Postgres RLS violation code 42501'],
  [{ message: 'new row violates row-level security policy' }, true, 'RLS message without a code'],
  [{ status: 401 }, true, 'HTTP 401'],
  [{ status: 403 }, true, 'HTTP 403'],
  [{ message: 'JWT expired' }, true, 'expired token'],
  [{ message: 'Invalid API key' }, true, 'revoked/invalid API key message'],
  [{ message: 'Failed to fetch' }, false, 'a network failure is transient, not a permission problem'],
  [{ status: 500, message: 'internal error' }, false, 'a server error is transient'],
  [null, false, 'no error'],
]) {
  assertEqual(isPermissionError(err), expected, `isPermissionError: ${label}`);
}

// supabase-js v2 puts the HTTP status on the RESULT object next to `error`, not on the
// error (Codex review 2026-09-30): a bare-message error with a 401/403 status must be blocked.
assertEqual(isPermissionError({ message: 'oops' }, 401), true, 'a 401 response status marks blocked even when the error has no status');
assertEqual(isPermissionError({ message: 'oops' }, 403), true, 'a 403 response status marks blocked');
assertEqual(isPermissionError({ message: 'oops' }, 500), false, 'a 500 response status is transient');
assertEqual(isPermissionError({ message: 'oops' }, undefined), false, 'no status and a non-permission message is transient');

// A later successful background flush clears blocked too (e.g. once access is restored).
{
  const statusState = { initFailed: false, pushInFlight: false, retrying: true, blocked: true };
  runFlushSuccess('{"a":1}', statusState, () => {});
  assertEqual(computeSyncStatus(statusState), 'synced', 'a successful flush clears blocked');
}

// The unload-flush path (raw fetch) must also flag a 401/403 instead of dropping it silently.
assertEqual(/else if \(resp\.status === 401 \|\| resp\.status === 403\) \{ statusState\.blocked = true;/.test(src), true, 'flushOnUnload marks a 401/403 response as blocked');

console.log('sync.selfcheck.js: all assertions passed');

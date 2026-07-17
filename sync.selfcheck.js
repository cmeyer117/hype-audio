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

console.log('sync.selfcheck.js: all assertions passed');

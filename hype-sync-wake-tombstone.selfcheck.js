// Run with: node hype-sync-wake-tombstone.selfcheck.js
// Audit 2026-11-20: hype-audio-3 (a clip tombstone kept its transcript, 168 KB of the 293 KB that deleted clips cost every sync write) and hype-audio-4
// (the realtime subscription never fired because app_state is not in the realtime publication, so an open tab never re-pulled). Source-level pins:
// both are wiring in browser-only files.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');

const hype = read('hype-audio.js');
const del = /function deleteClip\(id\) \{([\s\S]*?)\n  \}/.exec(hype);
assert.ok(del, 'deleteClip found');
assert.ok(/const \{ transcript_text, suggested_title, \.\.\.slim \} = clips\[idx\]/.test(del[1]), 'a tombstone drops transcript_text and suggested_title');
assert.ok(/deleted: true, deleted_at: Date\.now\(\), updated_at: Date\.now\(\)/.test(del[1]), 'and is still stamped deleted, deleted_at and updated_at');

const sync = read('sync.js');
assert.ok(!/postgres_changes/.test(sync) && !/\.channel\(/.test(sync), 'the dead realtime channel is gone');
assert.ok(/function wakePull\(\)/.test(sync) && /else \{ retryInit\(\); wakePull\(\); \}/.test(sync), 'becoming visible again runs a throttled re-pull');
assert.ok(/Date\.now\(\) - lastWakePull < 2 \* 60 \* 1000/.test(sync), 'the wake pull is throttled to once per 2 minutes');

console.log('hype-sync-wake-tombstone: all assertions passed');

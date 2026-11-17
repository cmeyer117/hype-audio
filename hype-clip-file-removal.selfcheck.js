// An offline/failed tombstone save must never delete shared audio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = { SUPABASE_CONFIG: { URL: 'https://fixture.invalid', KEY: 'fixture' } };
vm.runInNewContext(fs.readFileSync('sync.js', 'utf8'), { window });
assert.equal(window.hypeRemoveClipFile, undefined);
assert.equal(/hypeRemoveClipFile\(/.test(fs.readFileSync('index.html', 'utf8')), false);
assert.equal(/\.storage\.from\([^)]*\)\.remove\(/.test(fs.readFileSync('sync.js', 'utf8')), false);
console.log('PASS: foreground deletes retain shared audio until authoritative cleanup');

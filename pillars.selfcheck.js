// Run with: node pillars.selfcheck.js
// Keeps the home-tile pillar list, its metadata, its colour variable and the upload form's pillar dropdown in step, so a pillar added
// to one place cannot be missing from another (the Speeches pillar, 2026-10-12). Also pins that the automatic mid-set / PR pickers in
// hype-audio.js never name 'speeches': that section is opened by hand, never auto-played.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const lib = fs.readFileSync(path.join(__dirname, 'hype-audio.js'), 'utf8');

const order = /const PILLAR_ORDER = \[([^\]]*)\]/.exec(html);
assert.ok(order, 'PILLAR_ORDER not found');
const keys = [...order[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]);
assert.ok(keys.includes('speeches'), 'speeches is not in PILLAR_ORDER');

const meta = /const PILLARS = \{([\s\S]*?)\n    \};/.exec(html);
assert.ok(meta, 'PILLARS not found');
for (const k of keys) {
  assert.ok(new RegExp('\\b' + k + ':\\s*\\{[^}]*label:', 'm').test(meta[1]), `PILLARS has no entry with a label for ${k}`);
  assert.ok(new RegExp('--' + k + ':\\s*#[0-9a-fA-F]{3,8}').test(html), `no --${k} colour variable in :root`);
}

const select = /<select id="pillar-input"[\s\S]*?<\/select>/.exec(html);
assert.ok(select, 'pillar-input select not found');
const options = [...select[0].matchAll(/<option value="([a-z]+)"/g)].map(m => m[1]);
for (const k of keys) assert.ok(options.includes(k), `upload form pillar dropdown is missing ${k}`);

// hype-audio.js: no automatic picker may reach into speeches.
assert.ok(!/pillar:\s*(?:\[[^\]]*'speeches'|'speeches')/.test(lib), "an automatic picker in hype-audio.js names the 'speeches' pillar");

console.log('pillars.selfcheck: ok (' + keys.join(', ') + ')');

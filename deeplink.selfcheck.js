// Run with: node deeplink.selfcheck.js
// "Open in Hype" deep link (Vision connector, 2026-10-13): /?clip=<id> opens the clip's screen and highlights its row. It must never start
// playback, and an unknown or deleted id must do nothing. Pure resolver + static checks on index.html.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.Audio = function (src) { this.src = src; this.paused = true; };
global.Audio.prototype.play = function () { return Promise.resolve(); };
global.Audio.prototype.pause = function () {};
const HypeAudio = require('./hype-audio.js');

const clips = [
  { id: 'crispin', pillar: 'speeches', mentality: 'charge', title: 'Crispin' },
  { id: 'fresh', pillar: 'carl', mentality: '', title: 'Just recorded' },
  { id: 'gone', pillar: 'speeches', mentality: 'charge', title: 'Deleted', deleted: true },
  { id: 'weird<id>&x', pillar: 'carl', mentality: 'drive', title: 'Odd id' },
];

assert.strictEqual(typeof HypeAudio.resolveDeepLink, 'function', 'HypeAudio.resolveDeepLink is exported');
assert.deepStrictEqual(HypeAudio.resolveDeepLink('?clip=crispin', clips), { pillar: 'speeches', mentality: 'charge', id: 'crispin' }, 'finds an active clip');
assert.deepStrictEqual(HypeAudio.resolveDeepLink('?x=1&clip=crispin', clips), { pillar: 'speeches', mentality: 'charge', id: 'crispin' }, 'finds it among other params');
assert.deepStrictEqual(HypeAudio.resolveDeepLink('?clip=fresh', clips), { pillar: 'carl', mentality: '', id: 'fresh' }, 'an untagged clip still resolves (the page falls back to the pillar screen)');
assert.deepStrictEqual(HypeAudio.resolveDeepLink('?clip=' + encodeURIComponent('weird<id>&x'), clips), { pillar: 'carl', mentality: 'drive', id: 'weird<id>&x' }, 'an id with special characters round-trips');
for (const bad of ['', '?', '?clip=', '?clip=nope', '?clip=gone', '?other=crispin', 'clip=crispin?']) {
  assert.strictEqual(HypeAudio.resolveDeepLink(bad, clips), bad === 'clip=crispin?' ? null : null, 'no match for: ' + JSON.stringify(bad));
}
assert.strictEqual(HypeAudio.resolveDeepLink('?clip=crispin', []), null, 'an empty library resolves nothing');
assert.strictEqual(HypeAudio.resolveDeepLink(undefined, clips), null, 'a missing search string resolves nothing');

// ---- index.html wiring (static) ----
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.ok(/HypeAudio\.resolveDeepLink\(/.test(html), 'index.html calls resolveDeepLink');
assert.ok(/row\.dataset\.clipId = clip\.id/.test(html), 'section rows carry data-clip-id (compared by value, never through a selector built from an id)');
const fn = /function handleDeepLink\(\)[\s\S]*?\n    \}\n/.exec(html);
assert.ok(fn, 'handleDeepLink is defined');
assert.ok(!/playClip|playFromList|togglePlay|playRandom|\.play\(/.test(fn[0]), 'the deep link never starts playback');
assert.ok(/deepLinkClipId = target\.id/.test(fn[0]), 'the target id is remembered');
// An unknown pillar (legacy or mistyped synced clip) must be ignored, and nothing may throw out of the deep link: it can run inside the
// cloud-sync callback, where an exception would interrupt the rest of the sync apply.
assert.ok(/Object\.hasOwn\(PILLARS, target\.pillar\)/.test(fn[0]), 'a clip whose pillar is not a known pillar is ignored');
assert.ok(/try \{[\s\S]*catch/.test(fn[0]), 'showSection/showSubcats run inside a try/catch');
// The section is re-rendered when the clip-art manifest arrives, which wipes anything set on a row afterwards (found in the browser
// 2026-10-13): the mark must be applied while rows are built, from the remembered id.
assert.ok(/deepLinkClipId === clip\.id[\s\S]{0,80}dataset\.deeplinked = 'true'/.test(html), 'rows are marked while they are built, so a re-render keeps the mark');
assert.ok(/\.clip\[data-deeplinked="true"\]/.test(html), 'the marked row has a visible highlight style');
assert.ok(/handleDeepLink\(\)/.test(html.replace(fn[0], '')), 'handleDeepLink is invoked (on load and again after the first cloud sync)');
// renderSection reads consts declared late in the page script (openCueEdits, found in the browser 2026-10-13): the first call must come
// after the page's last init statement, and an early cloud sync must not run it before then.
const lastShowHome = html.lastIndexOf('showHome();');
const lastCall = html.lastIndexOf('handleDeepLink();');
assert.ok(lastCall > lastShowHome, 'handleDeepLink() runs after the final showHome() at the end of the page script');
assert.ok(/appReady/.test(fn[0]), 'handleDeepLink waits for appReady, so an early sync callback cannot run it too soon');
assert.ok(/appReady = true;\s*handleDeepLink\(\);/.test(html), 'appReady is set right before the first handleDeepLink() call');

console.log('deeplink.selfcheck: ok');

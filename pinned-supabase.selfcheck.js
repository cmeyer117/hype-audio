// Run with: node pinned-supabase.selfcheck.js
// The page loads the pinned Supabase library from this repo, never a floating CDN version (Opus auth pass 2026-11-12,
// finding B, swept from Steward 375b29c and Coaching 01d2666: a bad 2.x release or a CDN compromise would have run with
// the owner's session). The file is byte-identical to the published @supabase/supabase-js@2.118.0 dist/umd/supabase.js.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VENDORED = 'vendor/supabase-js-2.118.0.js';
const SHA256 = 'ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3';

// CRLF is folded back to LF first: a Windows checkout with core.autocrlf rewrites line endings, while git and Vercel hold the LF bytes.
const file = fs.readFileSync(path.join(__dirname, VENDORED), 'latin1').replace(/\r\n/g, '\n');
assert.equal(crypto.createHash('sha256').update(file, 'latin1').digest('hex'), SHA256, 'the vendored file must stay the published 2.118.0 build');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/@supabase|unpkg\.com\/@supabase/, 'index.html loads Supabase from a CDN');
assert.ok(html.includes(`<script src="${VENDORED}"></script>`), 'index.html loads the pinned copy');

console.log('ok: index.html loads the pinned Supabase copy');

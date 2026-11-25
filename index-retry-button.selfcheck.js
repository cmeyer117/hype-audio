// Run with: node index-retry-button.selfcheck.js
// 2026-11-25 phone-width audit: #retry-uploads had no style rule, so it showed as a raw white native button on the dark page.
// It must share the secondary-button rule (dark card background, border, light text) and keep a 44px tap target.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = (/<style[^>]*>([\s\S]*?)<\/style>/i.exec(html) || [])[1] || '';
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].split(',').map(s => s.trim()), body: m[2] }));

const tag = /<button\b[^>]*\bid="retry-uploads"[^>]*>/.exec(html);
assert.ok(tag, 'retry-uploads button must exist');
assert.ok(/\btype="button"/.test(tag[0]), 'retry-uploads must keep type="button"');
assert.ok(!/\bstyle=/.test(tag[0]), 'use the shared rule, not an inline style');

const styled = rules.filter(r => r.sel.includes('#retry-uploads'));
assert.ok(styled.some(r => /background:\s*var\(--bg-card\)/.test(r.body) && /border:\s*1px solid var\(--border-strong\)/.test(r.body) && /color:\s*var\(--text-primary\)/.test(r.body)),
  '#retry-uploads must be in the dark secondary-button rule (bg-card, border-strong, text-primary)');

const tap = rules.find(r => r.sel.includes('button') && /min-height:\s*44px/.test(r.body));
assert.ok(tap, 'the global button rule must keep min-height:44px');
assert.ok(/onclick\s*=\s*function \(\) \{ recoverUnfinishedUploads\(true\); \}/.test(html), 'retry click behaviour unchanged');

console.log('index retry button selfcheck: ok');

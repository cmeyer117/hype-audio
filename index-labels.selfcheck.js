// Run with: node index-labels.selfcheck.js
// Every <input> (except type=hidden/file/submit/button), <textarea> and <select> in index.html must have a matching
// <label for="its-id"> or a non-empty aria-label. Stricter than index-a11y.selfcheck.js: aria-labelledby does not count here.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function attr(tag, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : undefined;
}

const EXEMPT = new Set(['hidden', 'file', 'submit', 'button']);
const controls = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map(m => m[0])
  .filter(t => !EXEMPT.has(String(attr(t, 'type') || '').toLowerCase()));
assert.ok(controls.length > 0, 'found no form controls in index.html; the parser is broken');

const labelFor = new Set([...html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]));
const unlabelled = controls.filter(tag => {
  const id = attr(tag, 'id');
  return !(id && labelFor.has(id)) && (attr(tag, 'aria-label') || '').trim() === '';
}).map(tag => attr(tag, 'id') || tag.slice(0, 60));
assert.deepStrictEqual(unlabelled, [], `form controls with neither <label for> nor aria-label: ${unlabelled.join(', ')}`);

console.log(`index-labels selfcheck ok (${controls.length} controls)`);

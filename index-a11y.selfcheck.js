// Run with: node index-a11y.selfcheck.js
// Guards the accessible names of index.html's form controls (Codex portfolio audit 2026-10-06, finding 6: the search box and the
// upload/record fields were unnamed or relied on a placeholder, which is not a label and disappears as soon as you type; the six
// visible <label>s were not associated with their inputs). A control counts as named only with an aria-label / aria-labelledby, or a
// <label for="its-id">. Hidden inputs and buttons are exempt.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const tags = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map(m => m[0]);
const controls = tags.filter(t => !/\btype="(hidden|submit|button)"/.test(t));
assert.ok(controls.length >= 18, `expected to find the form controls, found ${controls.length}`);

const labelFor = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
const unnamed = [];
for (const tag of controls) {
  const id = (/\bid="([^"]+)"/.exec(tag) || [])[1];
  const ariaLabel = /\baria-label="[^"]+"/.test(tag) || /\baria-labelledby="[^"]+"/.test(tag);
  if (!ariaLabel && !(id && labelFor.has(id))) unnamed.push(id || tag.slice(0, 60));
}
assert.deepStrictEqual(unnamed, [], `form controls with no accessible name (a placeholder does not count): ${unnamed.join(', ')}`);

// Every <label for> must point at a control that exists, or the association is silently broken.
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const dangling = [...labelFor].filter(f => !ids.has(f));
assert.deepStrictEqual(dangling, [], `<label for> pointing at a missing id: ${dangling.join(', ')}`);

// The search box says what it searches, not just a placeholder.
const search = tags.find(t => /\bid="global-search-input"/.test(t));
assert.ok(search && /\baria-label="[^"]*search[^"]*"/i.test(search), 'the global search input needs a descriptive aria-label');

console.log(`index a11y selfcheck: all ${controls.length} controls named`);

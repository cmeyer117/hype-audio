// Run with: node index-a11y.selfcheck.js
// Guards the accessible names of index.html's form controls (Codex portfolio audit 2026-10-06, finding 6: the search box and the
// upload/record fields were unnamed or relied on a placeholder, which is not a label and disappears as soon as you type; the six
// visible <label>s were not associated with their inputs). A control counts as named only with a non-empty aria-label, an
// aria-labelledby that points at an element that exists, or a <label for="its-id">. Hidden inputs and buttons are exempt.
// Two kinds of control are checked: the static tags in the markup, and controls the page script creates with
// document.createElement('input' | 'select' | 'textarea') (the content-idea and mentality rows), which must get an aria-label.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// An attribute's value from one tag, either quote style, any case; undefined when absent.
function attr(tag, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : undefined;
}

const NOT_FIELDS = new Set(['hidden', 'submit', 'button', 'image', 'reset']);
const controls = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map(m => m[0])
  .filter(t => !NOT_FIELDS.has(String(attr(t, 'type') || '').toLowerCase()));
assert.ok(controls.length >= 18, `expected to find the static form controls, found ${controls.length}`);

const controlIds = controls.map(t => attr(t, 'id')).filter(Boolean);
const dupes = controlIds.filter((id, i) => controlIds.indexOf(id) !== i);
assert.deepStrictEqual(dupes, [], `duplicate control ids (a label would point at the wrong one): ${dupes.join(', ')}`);

const allIds = new Set([...html.matchAll(/\bid\s*=\s*"([^"]+)"/gi)].map(m => m[1]));
const labelFor = [...html.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"/gi)].map(m => m[1]);
const wrongTarget = labelFor.filter(f => !controlIds.includes(f));
assert.deepStrictEqual(wrongTarget, [], `<label for> that does not point at a form control (missing id, or a non-control): ${wrongTarget.join(', ')}`);

const unnamed = [];
for (const tag of controls) {
  const id = attr(tag, 'id');
  const aria = (attr(tag, 'aria-label') || '').trim() !== '';
  const refs = (attr(tag, 'aria-labelledby') || '').split(/\s+/).filter(Boolean);
  const labelledby = refs.length > 0 && refs.every(r => allIds.has(r));
  if (!aria && !labelledby && !(id && labelFor.includes(id))) unnamed.push(id || tag.slice(0, 60));
}
assert.deepStrictEqual(unnamed, [], `form controls with no accessible name (a placeholder does not count): ${unnamed.join(', ')}`);

// Controls the page script builds at runtime (no id, rows repeat per clip): each variable must be given an aria-label.
const runtime = [...html.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*document\.createElement\(\s*['"](input|select|textarea)['"]\s*\)/g)].map(m => m[1]);
assert.ok(runtime.length >= 4, `expected to find the runtime-created controls, found ${runtime.length}`);
const runtimeUnnamed = runtime.filter(v => !html.includes(`${v}.type = 'hidden'`) && !new RegExp('\\b' + v + '\\.setAttribute\\(\\s*[\'"]aria-label[\'"]\\s*,\\s*\\S').test(html));
assert.deepStrictEqual(runtimeUnnamed, [], `runtime-created controls with no aria-label: ${runtimeUnnamed.join(', ')}`);

// The search box says what it searches, not just a placeholder.
const search = controls.find(t => attr(t, 'id') === 'global-search-input');
assert.ok(search && /search/i.test(attr(search, 'aria-label') || ''), 'the global search input needs a descriptive aria-label');

console.log(`index a11y selfcheck: ${controls.length} static + ${runtime.length} runtime controls named`);

// Only the app is served. Vercel publishes every tracked file that .vercelignore does not name, so docs, tests and
// tooling must be named there (audit 2026-11-12: /CLAUDE.md, docs/, scripts/ and the root self-checks were public).
'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const PRIVATE = /\.md$|^\.(claude|github)\/|^(docs|scripts|tests)\/|\.selfcheck\.js$/;

// ponytail: reads the pattern shapes this repo uses (name, *.ext, dir/*.ext). Negation and ** are refused below
// rather than half-supported.
const toRe = (p) => {
  assert.doesNotMatch(p, /^!|\*\*/, 'unsupported .vercelignore pattern: ' + p);
  const body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp((p.includes('/') ? '^' : '(^|/)') + body + '(/|$)');
};
const ignored = readFileSync(join(__dirname, '.vercelignore'), 'utf8')
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(toRe);

const tracked = execFileSync('git', ['ls-files'], { cwd: __dirname, encoding: 'utf8' }).split('\n').filter(Boolean);
const exposed = tracked.filter((f) => PRIVATE.test(f) && !ignored.some((re) => re.test(f)));
assert.deepEqual(exposed, [], 'these files would be served publicly; name them in .vercelignore');

console.log('ok: no docs, tests or tooling files are served');

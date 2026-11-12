// Self-check: Vercel deploys every non-underscore file in api/ as a function (Hobby plan cap: 12),
// and *.selfcheck.js files must be excluded via .vercelignore so they don't ship as public endpoints.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_FUNCTIONS = 12;
const root = path.join(__dirname, '..');

function fail(label) { console.error('FAIL: ' + label); process.exit(1); }

const fns = fs.readdirSync(__dirname).filter((n) =>
  /\.(mjs|js)$/.test(n) && !/\.selfcheck\.js$/.test(n) && !n.startsWith('_'));
if (fns.length > MAX_FUNCTIONS) fail('api/ has ' + fns.length + ' functions (max ' + MAX_FUNCTIONS + '): ' + fns.join(', '));

const ignorePath = path.join(root, '.vercelignore');
if (!fs.existsSync(ignorePath)) fail('.vercelignore is missing');
const lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/).map((l) => l.trim());
if (!lines.includes('api/*.selfcheck.js')) fail('.vercelignore must contain api/*.selfcheck.js');
if (!lines.includes('mc-reports')) fail('.vercelignore must contain mc-reports');

console.log('ok: ' + fns.length + '/' + MAX_FUNCTIONS + ' functions, selfchecks ignored');

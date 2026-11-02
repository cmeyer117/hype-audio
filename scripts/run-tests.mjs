// Runs every top-level *.selfcheck.js via plain `node` (scripts/ holds one-off maintenance tools, not checks).
// Same no-framework convention as Row and Steward; added 2026-11-02 so the repo has one test command
// (engineering-standard health item 1).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync(process.cwd()).filter((name) => /\.selfcheck\.js$/.test(name)).sort();
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`PASS ${file}`);
  } else {
    failed++;
    console.log(`FAIL ${file} (exit ${result.status})`);
    console.log(result.stdout);
    console.log(result.stderr);
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed > 0 || files.length === 0 ? 1 : 0);

// Runs every top-level and api/ *.selfcheck.js via plain `node` (scripts/ holds one-off maintenance tools, not checks).
// Same no-framework convention as Row and Steward; added 2026-11-02 so the repo has one test command
// (engineering-standard health item 1).
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = [
  ...readdirSync(process.cwd()).filter((name) => /\.selfcheck\.js$/.test(name)).sort(),
  ...readdirSync('api').filter((name) => /\.selfcheck\.js$/.test(name)).sort().map((name) => 'api/' + name),
];
let failed = 0;
// A leaked timer or open handle makes one check hang forever and the whole run with it; each file gets a limit (2026-11-23).
const FILE_TIMEOUT_MS = Number(process.env.TEST_FILE_TIMEOUT_MS) || 120_000;

for (const file of files) {
  const result = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: FILE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.status === 0) {
    console.log(`PASS ${file}`);
  } else {
    failed++;
    console.log(`FAIL ${file} (exit ${result.status}${result.signal ? `, signal ${result.signal}` : ''})`);
    if (result.error?.code === 'ETIMEDOUT') console.log(`  timed out after ${FILE_TIMEOUT_MS} ms (a leaked timer or open handle?)`);
    console.log(result.stdout);
    console.log(result.stderr);
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed > 0 || files.length === 0 ? 1 : 0);

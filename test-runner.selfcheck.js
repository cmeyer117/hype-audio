const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const parent = fs.realpathSync(os.tmpdir());
const dir = fs.mkdtempSync(path.join(parent, 'hype-runner-test-'));
try {
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'api', '_lib'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'scripts', 'run-tests.mjs'), path.join(dir, 'scripts', 'run-tests.mjs'));
  fs.writeFileSync(path.join(dir, 'root.selfcheck.js'), 'console.log("root complete")');
  const nested = path.join(dir, 'api', '_lib', 'auth.selfcheck.js');
  fs.writeFileSync(nested, 'console.error("nested authorization regression"); process.exitCode=1');
  const run = () => spawnSync(process.execPath, ['scripts/run-tests.mjs'], { cwd: dir, encoding: 'utf8', timeout: 5000, windowsHide: true });
  const failed = run();
  assert.equal(failed.status, 1, 'a failing nested authorization test must fail the suite');
  assert.match(failed.stdout, /auth\.selfcheck\.js/);
  fs.writeFileSync(nested, 'console.log("auth complete")');
  fs.writeFileSync(path.join(dir, 'root.selfcheck.js'), '(async()=>{await new Promise(()=>{});throw Error("never reached")})()');
  assert.equal(run().status, 1, 'a silently abandoned async test must not pass');
  fs.writeFileSync(path.join(dir, 'root.selfcheck.js'), 'console.log("root complete")');
  assert.equal(run().status, 0, 'completed root and nested checks pass');
  console.log('PASS the test runner includes nested authorization checks and rejects silent async exits');
} finally {
  const target = fs.realpathSync(dir);
  assert.equal(path.dirname(target), parent);
  assert.ok(path.basename(target).startsWith('hype-runner-test-'));
  fs.rmSync(target, { recursive: true, force: true });
}

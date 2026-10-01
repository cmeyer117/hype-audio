const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

(async () => {
  for (const file of ['bulk-upload-hype.js', 'update-existing-clips.js', 'fix-broken-storage-urls.js', 'fix-double-prefix.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const read = source.match(/const supa = createClient[\s\S]*?const (?:existing|clips) = [^\n]+;/)[0];
    const run = new AsyncFunction('createClient', 'SUPABASE_URL', 'SUPABASE_KEY', 'APP_KEY', read);
    for (const result of [
      { data: null, error: { message: 'Denied' } },
      { data: null, error: null },
      { data: { data: {} }, error: null },
    ]) {
      const client = {
        auth: { signInAnonymously: async () => { throw new Error('Must retain service-role authorization'); } },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
      };
      await assert.rejects(run(() => client, 'test-url', 'SERVICE-KEY', 'hype-audio'), /library|Denied/, `${file} must stop when the library cannot be read`);
    }
    const serviceClient = {
      auth: { signInAnonymously: async () => { throw new Error('Must retain service-role authorization'); } },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { data: { hype_audio: [] } }, error: null }) }) }) }),
    };
    await run(() => serviceClient, 'test-url', 'SERVICE-KEY', 'hype-audio');
    const payload = source.match(/\.upsert\(\s*(\{[^\n]+\})/)[1];
    const actual = vm.runInNewContext(`(${payload})`, { APP_KEY: 'hype-audio', row: { data: { hype_audio_events: ['retained'] } }, merged: [], clips: [], updated: [], kept: [], Date });
    assert.equal(actual.data.hype_audio_events[0], 'retained', `${file} must preserve the other row fields`);
  }
  console.log('maintenance-auth.selfcheck: all four scripts fail safely and preserve other fields');
})().catch(error => { console.error(error); process.exitCode = 1; });

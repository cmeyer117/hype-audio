const assert = require('node:assert/strict');
const store = { hype_audio_upload_secret: 'fixture-only' };
global.localStorage = { getItem: key => store[key] ?? null, setItem: (key, value) => { store[key] = value; } };
const originalTimer = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => originalTimer(fn, ms === 20000 || ms === 120000 ? 5 : ms, ...args);
const HypeAudio = require('./hype-audio.js');
const file = { name: 'fixture.webm', size: 12, type: 'audio/webm' };
const clip = { id: 'fixture', title: 'Fixture', storage_url: 'https://fixture.invalid/clip.webm' };
let phase = 'authorize';
let missingSignal = false;
global.fetch = async (_url, options) => {
  const data = options.method === 'PUT' ? {} : JSON.parse(options.body);
  if ((phase === 'authorize' && !data.action) || (phase === 'transfer' && options.method === 'PUT')) {
    if (!options.signal) { missingSignal = true; throw new Error('fixture missing deadline'); }
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture timeout'))));
  }
  return { ok: true, status: 200, json: async () => data.action === 'complete'
    ? { confirmed: true, clip } : { uploadUrl: 'https://fixture.invalid/put', publicUrl: clip.storage_url } };
};
async function main() {
  assert.equal((await HypeAudio.uploadClipFile(file, clip)).url, null);
  assert.equal(missingSignal, false, 'authorization needs a deadline');
  phase = 'transfer';
  assert.equal((await HypeAudio.uploadClipFile(file, clip)).url, clip.storage_url, 'a timed-out transfer still checks the durable object receipt');
  assert.equal(missingSignal, false, 'transfer needs a deadline');
  console.log('upload-deadline.selfcheck.js: bounded authorization and transfer preserve recovery');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.setTimeout = originalTimer; });

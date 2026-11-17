const assert = require('node:assert/strict');
const store = { hype_audio_upload_secret: 'fixture-only' };
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
const HypeAudio = require('./hype-audio.js');
const clip = { id: 'stable', title: 'Recording', storage_url: 'https://fixture.invalid/audio.webm' };
let confirmed = false;
const requests = [];
global.fetch = async (url, options) => {
  if (options.method === 'PUT') throw new Error('lost response after storage committed');
  const body = JSON.parse(options.body);
  requests.push(body);
  const response = body.action === 'complete' ? { confirmed, clip }
    : body.action === 'recover' ? { clips: [clip], pending: 0 }
      : { uploadUrl: 'https://fixture.invalid/put', publicUrl: clip.storage_url };
  return { ok: true, status: 200, json: async () => response };
};
async function main() {
  const file = { name: 'recording.webm', size: 15, type: 'audio/webm' };
  assert.equal((await HypeAudio.uploadClipFile(file, clip)).url, null);
  assert.equal(HypeAudio.listClips().length, 0);
  confirmed = true;
  assert.equal((await HypeAudio.uploadClipFile(file, clip)).url, clip.storage_url);
  await HypeAudio.recoverUploads();
  assert.equal(HypeAudio.listClips().length, 1);
  assert.equal(requests.filter(r => !r.action).every(r => r.metadata.id === 'stable'), true);
  HypeAudio.updateClip('stable', { deleted: true });
  await HypeAudio.recoverUploads();
  assert.equal(HypeAudio.listClips()[0].deleted, true);
  console.log('upload-client-recovery.selfcheck.js: uncertain PUT, confirmation and recovery are idempotent');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

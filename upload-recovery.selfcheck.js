const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { prepareUpload, completeUpload, recoverUploads } = await import('./api/_lib/upload-intents.mjs');
  const rows = new Map(), objects = new Set();
  let rejectLibraryWrite = true;
  const db = {
    storage: { from: () => ({ list: async (_folder, options) => ({ data: objects.has(options.search) ? [{ name: options.search, metadata: { size: 10 } }] : [] }) }) },
    from() {
      let key, changes, expected, prefix, phase, limit;
      const q = {
        select() { return q; },
        eq(field, value) { if (field === 'key') key = value; if (field === 'updated_at') expected = value; if (field === 'data->>phase') phase = value; return q; },
        like(_field, value) { prefix = value.slice(0, -1); return q; },
        order() { return q; },
        limit(value) { limit = value; return q; },
        is(field) { if (field === 'updated_at') expected = null; return q; },
        maybeSingle: async () => ({ data: rows.get(key) ?? null }),
        insert(row) { key = row.key; changes = row; return q; },
        update(row) { changes = row; return q; },
        then(resolve, reject) {
          if (prefix) return Promise.resolve({ data: [...rows.values()].filter(row => row.key.startsWith(prefix) && row.data.phase === phase).slice(0, limit) }).then(resolve, reject);
          if (key === 'hype-audio' && rejectLibraryWrite) return Promise.resolve({ error: { message: 'synthetic denial' } }).then(resolve, reject);
          if (expected !== undefined && rows.get(key)?.updated_at !== expected) return Promise.resolve({ data: [] }).then(resolve, reject);
          if (phase && rows.get(key)?.data?.phase !== phase) return Promise.resolve({ data: [] }).then(resolve, reject);
          const saved = { ...rows.get(key), ...structuredClone(changes) };
          rows.set(key, saved);
          return Promise.resolve({ data: [saved] }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const metadata = { id: 'fixture-upload', title: 'Fixture recording', pillar: 'carl' };
  await prepareUpload(db, metadata.id, 'fixture.webm', metadata, 'https://fixture.invalid/fixture.webm');
  assert.equal(rows.has('hype:upload:fixture-upload'), true);
  assert.equal((await completeUpload(db, metadata.id)).confirmed, false);
  objects.add('fixture.webm');
  await assert.rejects(completeUpload(db, metadata.id), /metadata/);
  assert.equal(rows.get('hype:upload:fixture-upload').data.phase, 'pending');
  rejectLibraryWrite = false;
  assert.equal((await completeUpload(db, metadata.id)).confirmed, true);
  assert.equal((await completeUpload(db, metadata.id)).confirmed, true);
  assert.equal(rows.get('hype-audio').data.hype_audio.length, 1);
  rows.get('hype-audio').data.hype_audio[0].deleted = true;
  await assert.rejects(completeUpload(db, metadata.id), /deleted/);
  rows.clear();
  for (let n = 0; n < 11; n++) {
    const id = 'batch-' + n, name = id + '.webm';
    objects.add(name);
    await prepareUpload(db, id, name, { id, title: id }, 'https://fixture.invalid/' + name);
  }
  const first = await recoverUploads(db);
  assert.equal(first.clips.length, 10);
  assert.equal(first.hasMore, true, 'recovery must disclose work beyond the first batch');
  const last = await recoverUploads(db);
  assert.equal(last.clips.length, 1);
  assert.equal(last.hasMore, false);
  const html = fs.readFileSync('index.html', 'utf8');
  assert.equal(/window\.hypeRemoveClipFile\(/.test(html), false, 'physical cleanup waits for the authoritative orphan guard');
  console.log('upload-recovery.selfcheck.js: intents survive failed metadata and retries preserve identity');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

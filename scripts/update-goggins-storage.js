// Swaps the 33 Goggins clips in Storage for the re-timed mixes, using
// versioned object names (_v2) so stale CDN caches of the old names
// can't serve the old audio. Patches only the goggins entries'
// storage_url in app_state; rants entries are untouched.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv';
const APP_KEY = 'hype-audio';
const SUFFIX = '_v2';
const MANIFEST = path.join(__dirname, 'output', 'final-manifest.json');

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const goggins = manifest.filter((m) => m.mentality === 'goggins');
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

  const urlById = {};
  for (const item of goggins) {
    const storageName = item.id + SUFFIX + '.mp3';
    process.stdout.write(`uploading ${storageName}... `);
    const { error } = await supa.storage.from('hype-audio').upload(storageName, fs.readFileSync(item.localFile), {
      contentType: 'audio/mpeg', upsert: false,
    });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      console.log('FAILED: ' + error.message); process.exit(1);
    }
    console.log(error ? 'ok (already uploaded)' : 'ok');
    const { data: pub } = supa.storage.from('hype-audio').getPublicUrl(storageName);
    urlById[item.id] = pub.publicUrl;
  }

  const { data: row, error: readErr } = await supa.from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
  if (readErr || !row) { console.error('app_state read failed'); process.exit(1); }
  const clips = row.data.hype_audio.map((c) =>
    urlById[c.id] ? { ...c, storage_url: urlById[c.id] } : c
  );
  const { error: writeErr } = await supa.from('app_state').upsert(
    { key: APP_KEY, data: { hype_audio: clips }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeErr) { console.error('app_state write failed:', writeErr.message); process.exit(1); }

  // Remove the superseded unversioned goggins objects (exact names only).
  const oldNames = goggins.map((item) => item.id + '.mp3');
  const { error: delErr } = await supa.storage.from('hype-audio').remove(oldNames);
  if (delErr) console.error('cleanup failed (non-fatal):', delErr.message);
  else console.log(`removed ${oldNames.length} superseded objects`);

  console.log(`\nDone. ${goggins.length} goggins clips re-timed and swapped.`);
}

main();

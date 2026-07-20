// Publishes the curated clip set: uploads final-clips, rewrites the
// app_state hype_audio array from final-manifest.json, then removes the
// specific superseded objects from the previous (uncurated) upload —
// only names derived from goggins-mixed-manifest.json, never a blanket
// bucket wipe.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv';
const APP_KEY = 'hype-audio';
const MANIFEST = path.join(__dirname, 'output', 'final-manifest.json');
const OLD_MANIFEST = path.join(__dirname, 'output', 'goggins-mixed-manifest.json');

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Upload the curated set.
  const clips = [];
  for (const item of manifest) {
    const storageName = item.id + '.mp3';
    process.stdout.write(`uploading ${storageName}... `);
    const { error } = await supa.storage.from('hype-audio').upload(storageName, fs.readFileSync(item.localFile), {
      // ponytail: upsert needs a storage UPDATE policy that doesn't exist;
      // names are unique per curation run, so plain insert is fine.
      contentType: 'audio/mpeg', upsert: false,
    });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      console.log('FAILED: ' + error.message); process.exit(1);
    }
    console.log(error ? 'ok (already uploaded)' : 'ok');
    const { data: pub } = supa.storage.from('hype-audio').getPublicUrl(storageName);
    clips.push({
      id: item.id,
      title: item.title,
      mentality: item.mentality,
      pillar: item.pillar,
      moment: item.moment,
      source_type: item.source_type,
      duration_seconds: item.duration_seconds,
      storage_url: pub.publicUrl,
      created_at: new Date().toISOString(),
      play_count: 0,
    });
  }

  // 2. Rewrite the app's clip list (curated set fully supersedes old).
  const { error: writeErr } = await supa.from('app_state').upsert(
    { key: APP_KEY, data: { hype_audio: clips }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeErr) { console.error('app_state write failed:', writeErr.message); process.exit(1); }

  // 3. Remove exactly the superseded objects from the previous upload.
  const oldNames = JSON.parse(fs.readFileSync(OLD_MANIFEST, 'utf8')).map((item) =>
    'clip_' + path.basename(item.localFile, '.mp3').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.mp3'
  );
  const newNames = new Set(clips.map((c) => c.id + '.mp3'));
  const toRemove = oldNames.filter((n) => !newNames.has(n));
  if (toRemove.length > 0) {
    const { error: delErr } = await supa.storage.from('hype-audio').remove(toRemove);
    if (delErr) console.error('cleanup of old objects failed (non-fatal):', delErr.message);
    else console.log(`removed ${toRemove.length} superseded objects`);
  }

  console.log(`\nDone. Library: ${clips.length} clips (${clips.filter((c) => c.pillar === 'faith').length} faith, ${clips.filter((c) => c.pillar === 'iron').length} iron).`);
}

main();

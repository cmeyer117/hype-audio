// Uploads a manifest of local audio files into the hype-audio Supabase
// Storage bucket, then appends their metadata into the app's own
// app_state row (key: 'hype-audio', array: hype_audio) — same shape
// hype-audio.js's addClip()/uploadClipFile() produce from the browser.
//
// Usage: node bulk-upload-hype.js <manifest.json>
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv';
const APP_KEY = 'hype-audio';

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node bulk-upload-hype.js <manifest.json>');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  // Storage RLS requires an authenticated (even anonymous) session — the
  // browser client gets this implicitly; a bare Node script doesn't.
  await supa.auth.signInAnonymously();

  const { data: row } = await supa.from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
  const existing = (row && row.data && Array.isArray(row.data.hype_audio)) ? row.data.hype_audio : [];
  const existingIds = new Set(existing.map((c) => c.id));

  const newClips = [];
  for (const item of manifest) {
    const id = 'clip_' + path.basename(item.localFile, path.extname(item.localFile)).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (existingIds.has(id)) {
      console.log('skip (already uploaded):', id);
      continue;
    }
    const fileBuf = fs.readFileSync(item.localFile);
    const storageName = id + '.mp3';
    console.log('uploading', storageName);
    const { error: upErr } = await supa.storage.from('hype-audio').upload(storageName, fileBuf, {
      contentType: 'audio/mpeg',
      upsert: false,
    });
    if (upErr) {
      console.error('  upload failed:', upErr.message);
      continue;
    }
    const { data: pub } = supa.storage.from('hype-audio').getPublicUrl(storageName);
    newClips.push({
      id,
      title: item.title,
      mentality: item.mentality,
      moment: item.moment,
      source_type: item.source_type,
      storage_url: pub.publicUrl,
      created_at: new Date().toISOString(),
      play_count: 0,
    });
  }

  if (newClips.length === 0) {
    console.log('Nothing new to write.');
    return;
  }

  const merged = existing.concat(newClips);
  const { error: writeErr } = await supa.from('app_state').upsert(
    { key: APP_KEY, data: { hype_audio: merged }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeErr) {
    console.error('app_state write failed:', writeErr.message);
    process.exit(1);
  }
  console.log(`Done. ${newClips.length} new clips written (${merged.length} total).`);
}

main();

// Overwrites storage + app_state metadata for a fixed list of already-live
// clip ids from final-manifest.json (in place -- no new rows, no dedup
// logic). Used when a clip gets rebuilt (e.g. re-trimmed, or un-trimmed
// back to full length) and needs to replace what's already live.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co';
// Owner-only RLS since 2026-09-30: the anon key can no longer read or write the hype-audio row
// (or write storage). Run with the service role, e.g. from PowerShell:
//   $env:SUPABASE_SERVICE_ROLE_KEY = (Select-String '^SUPABASE_SERVICE_ROLE_KEY=' C:\Users\gregm\jarvis-embed\.env).Line.Split('=',2)[1]
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (see C:\\Users\\gregm\\jarvis-embed\\.env): the anon key can no longer read or write the hype-audio row.');
  process.exit(1);
}
const APP_KEY = 'hype-audio';

const IDS = new Set(fs.readFileSync('C:/Users/gregm/AppData/Local/Temp/rebuild_ids.txt', 'utf8').trim().split('\n'));

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'final-manifest.json'), 'utf8'));
  const targets = manifest.filter((m) => IDS.has(m.id));
  console.log(`${targets.length} of ${IDS.size} target ids found in manifest.`);

  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: row, error: readError } = await supa.from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
  if (readError || !Array.isArray(row?.data?.hype_audio)) throw new Error('Could not read the existing hype library; refusing to modify it.');
  const clips = row.data.hype_audio;

  const toDelete = [];
  for (const item of targets) {
    const idx = clips.findIndex((c) => c.id === item.id);
    if (idx === -1) { console.error('no existing entry for', item.id); continue; }

    // Anon role can INSERT and DELETE storage objects but not UPDATE/upsert
    // an existing one (RLS) -- upload under a new name instead, repoint
    // storage_url, then delete the now-orphaned old file.
    const oldName = decodeURIComponent(clips[idx].storage_url.split('/hype-audio/')[1]);
    const newName = item.id + '_full.mp3';
    const fileBuf = fs.readFileSync(item.localFile);
    console.log('uploading', newName, `(${item.duration_seconds}s)`);
    const { error: upErr } = await supa.storage.from('hype-audio').upload(newName, fileBuf, {
      contentType: 'audio/mpeg',
      upsert: false,
    });
    if (upErr) { console.error('  upload failed:', upErr.message); continue; }

    const { data: pub } = supa.storage.from('hype-audio').getPublicUrl(newName);
    clips[idx] = { ...clips[idx], title: item.title, duration_seconds: item.duration_seconds, storage_url: pub.publicUrl };
    toDelete.push(oldName);
  }

  if (toDelete.length > 0) {
    console.log(`\nDeleting ${toDelete.length} orphaned old files.`);
    const { error: delErr } = await supa.storage.from('hype-audio').remove(toDelete);
    if (delErr) console.error('  cleanup failed:', delErr.message);
  }

  const { error: writeErr } = await supa.from('app_state').upsert(
    { key: APP_KEY, data: { ...row.data, hype_audio: clips }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeErr) { console.error('app_state write failed:', writeErr.message); process.exit(1); }
  console.log('Done.');
}

main();

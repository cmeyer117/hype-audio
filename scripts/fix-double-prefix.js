// One-off fix for a bulk-upload-hype.js bug: build-final-clips.js already
// bakes "clip_" into its output filenames, and bulk-upload-hype.js prepends
// "clip_" again, producing "clip_clip_*" ids. This duplicated 67
// already-existing goggins/rants clips and left the 32 genuinely-new
// new_rants clips with a double-prefixed id.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv';
const APP_KEY = 'hype-audio';

async function main() {
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supa.auth.signInAnonymously();

  const { data: row } = await supa.from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
  const clips = row.data.hype_audio;
  const byId = new Map(clips.map((c) => [c.id, c]));

  const toDeleteStorage = [];
  const kept = [];
  for (const c of clips) {
    if (!c.id.startsWith('clip_clip_')) {
      kept.push(c);
      continue;
    }
    const singleId = c.id.replace('clip_clip_', 'clip_');
    if (byId.has(singleId)) {
      // duplicate of an already-existing clip -- drop it, queue storage cleanup
      toDeleteStorage.push(c.storage_url.split('/hype-audio/')[1]);
      console.log('dropping duplicate:', c.id, '(of', singleId + ')');
    } else {
      // genuinely new -- rename id + storage object to the correct single prefix
      const oldName = c.storage_url.split('/hype-audio/')[1];
      const newName = oldName.replace('clip_clip_', 'clip_');
      console.log('renaming new clip:', c.id, '->', singleId);
      const { error: moveErr } = await supa.storage.from('hype-audio').move(oldName, newName);
      if (moveErr && !moveErr.message.includes('not found')) {
        console.error('  move failed:', moveErr.message);
      }
      const { data: pub } = supa.storage.from('hype-audio').getPublicUrl(newName);
      kept.push({ ...c, id: singleId, storage_url: pub.publicUrl });
    }
  }

  console.log(`\n${toDeleteStorage.length} duplicate storage objects to delete, ${kept.length} clips kept (was ${clips.length}).`);

  if (toDeleteStorage.length > 0) {
    const { error: delErr } = await supa.storage.from('hype-audio').remove(toDeleteStorage);
    if (delErr) console.error('storage cleanup failed:', delErr.message);
  }

  const { error: writeErr } = await supa.from('app_state').upsert(
    { key: APP_KEY, data: { hype_audio: kept }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeErr) {
    console.error('app_state write failed:', writeErr.message);
    process.exit(1);
  }
  console.log('Done.');
}

main();

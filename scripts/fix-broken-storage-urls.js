// fix-double-prefix.js tried to storage.move() the 32 new_rants files from
// their double-prefixed upload name to a clean single-prefixed name, then
// rewrote storage_url to the new name regardless of whether the move
// actually succeeded. It silently failed (anon role can't move/update
// storage objects), so storage_url now points at files that don't exist.
// The real audio still sits at the original clip_clip_* name. Repoint
// storage_url back to the working file -- no data movement needed, the
// id field (already clean) is what the app actually keys off of.
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

async function main() {
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: row, error: readError } = await supa.from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
  if (readError || !Array.isArray(row?.data?.hype_audio)) throw new Error('Could not read the existing hype library; refusing to modify it.');
  const clips = row.data.hype_audio;

  // Only the 32 new_rants ids -- everything else's storage_url is already correct.
  const NEW_RANT_IDS = new Set(require('./curation.json').new_rants
    ? [...new Set([...require('./curation.json').new_rants.keep, ...Object.keys(require('./curation.json').new_rants.trim)])]
        .map((base) => 'clip_' + base.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    : []);

  let fixed = 0;
  const updated = clips.map((c) => {
    if (!NEW_RANT_IDS.has(c.id)) return c;
    const doubleName = 'clip_' + c.id + '.mp3'; // clip_ + clip_<base> = clip_clip_<base>
    const { data: pub } = supa.storage.from('hype-audio').getPublicUrl(doubleName);
    if (c.storage_url === pub.publicUrl) return c; // already correct
    fixed++;
    return { ...c, storage_url: pub.publicUrl };
  });

  console.log(`Repointing ${fixed} storage_url(s).`);
  if (fixed === 0) { console.log('Nothing to fix.'); return; }

  const { error: writeErr } = await supa.from('app_state').upsert(
    { key: APP_KEY, data: { ...row.data, hype_audio: updated }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (writeErr) { console.error('write failed:', writeErr.message); process.exit(1); }
  console.log('Done.');
}

main();

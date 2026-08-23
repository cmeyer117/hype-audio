// Shared Supabase connection config -- single source of truth so a
// publishable-key rotation is a one-file edit instead of a repo-wide
// find/replace. Not a secret: the publishable/anon key is designed to be
// public in client code, RLS is what protects the data.
window.SUPABASE_CONFIG = {
  URL: 'https://vikpcejlyxieguorwysf.supabase.co',
  KEY: 'sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv',
};

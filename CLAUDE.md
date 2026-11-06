# hype-audio-app

Carl's hype clip library (static HTML/JS on Vercel, Supabase project `vikpcejlyxieguorwysf`). Follows `G:\My Drive\Claude\docs\engineering-standard.md`.

- **Test:** `npm test` runs every top-level `*.selfcheck.js`. Bug fixes land with a selfcheck that failed first.
- **Deploy:** push to `master` (Vercel). Verify the page loads and a clip plays after a deploy.
- **Data:** clip metadata lives in `app_state` key `hype-audio` (owner session via `hype-auth.js`); audio files in the public `hype-audio` storage bucket. Uploads go through `/api/upload-clip` (service role, passphrase). Deletes remove the file with the owner session (`sync.js` `hypeRemoveClipFile`); signed-out deletes leave it for the weekly orphan guard.
- **Secrets:** server keys only in Vercel env or a local `.env` (gitignored). Never in the repo.
- **Consumers:** any change to what this app reads or writes in Supabase updates `Carl Meyer\10 - AI & Tech Knowledge\Supabase Key Consumers.md`.
- **Row:** Row's gym player is its own fork, `C:\Users\gregm\row\row-hype.js` (renamed from a hand-copied `hype-audio.js` on 2026-11-05 after it diverged by 2,000+ lines). Nothing is copied between the repos: a playback fix Row needs too is a second commit there.

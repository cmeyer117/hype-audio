---
name: verify
description: Known environment limitation for verifying this repo, and the working alternative
---

Static site, no build step, no bundler (`hype-audio.js`'s own header comment confirms this). The surface is the GUI in a browser.

**Known limitation, hit repeatedly (first noted building this app, confirmed again 2026-07-17):** this Claude Code environment's Browser pane blocks both `file://` URLs and `http://localhost:*` by policy — "blocked by policy and cannot be opened in the Browser pane." A local Python `http.server` on a free port gets the same block. There is currently no way to drive this app's UI locally from inside this environment's Browser pane.

**Correction 2026-07-17:** the live `hype-audio-app.vercel.app` URL was ALSO blocked when tried ("blocked by policy"), not just `file://`/`localhost` as first assumed. So all three of the obvious routes into this app's GUI are closed from inside this environment's Browser pane, at least in this session — unclear if that's permanent or session-specific. Don't assume the Vercel URL works without trying it fresh.

**What actually works:** direct Supabase checks (`execute_sql` against the `app_state` table, `key = 'hype-audio'`) for confirming data-layer state (clip count, shape). For a true UI check, ask Carl to open the live URL himself in his own browser and report what he sees — that's outside this sandboxed pane's restrictions.

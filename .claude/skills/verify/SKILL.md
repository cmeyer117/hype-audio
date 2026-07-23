---
name: verify
description: Known environment limitation for verifying this repo, and the working alternative
---

Static site, no build step, no bundler (`hype-audio.js`'s own header comment confirms this). The surface is the GUI in a browser.

**Correction 2026-07-23:** the earlier "localhost is blocked" note was wrong for the actual working path. Raw `navigate` to an ad-hoc `http.server`/manual port gets blocked by policy, but launching via the registered `.claude/launch.json` config (`preview_start` with `{name: "hype-audio"}`, port 5557) works fine — full DOM access via `read_page`, `computer` clicks, `javascript_tool`, `read_console_messages`, `read_network_requests`. Confirmed working end-to-end: navigated home, clicked into a pillar section, confirmed clip list rendered, clicked play, clicked back, confirmed tiles re-rendered — no console errors beyond pre-existing unrelated Supabase multi-client warnings.

**Known residual limitation:** the `computer` screenshot/zoom actions still time out consistently in this environment (separate, longer-standing bug, not specific to this app) — use `read_page`/`javascript_tool` computed-style checks instead of screenshots to verify rendering.

**What works:** `preview_start` with the named `hype-audio` launch config, then drive it like any other page. Direct Supabase checks (`execute_sql` against `app_state`, `key = 'hype-audio'`) remain useful for data-layer-only questions. For pixel-level aesthetic judgment (not just "did it render"), still worth asking Carl to eyeball it live, since screenshots don't work here.

# Hype fold 1 — copy and acceptance note

Source: local branch codex/hype-fold-1, based on master4e94c2238091a3659d05fa5d1551244a40627ba9. This note covers the October14 fold run, not deployment or a reconciliation of older player-copy differences.

## Exact shared-file changes

**No re-copy required.** Neither canonical `hype-audio.js` nor `quote-bed.js` changed in this run. Git's normalized blob identities at the base and after the code changes match:

| File | Base and resulting blob |
|---|---|
| hype-audio.js | b05d6e24e9a53ed26d311ac73551c920e588fafd |
| quote-bed.js | e6c13fa88940ef626b102cca748dac6fbcbb245a |

Exact diff required in Row: empty. Exact diff required in Vessel: empty. No file, export, adapter, HTML dependency, storage key or service-worker change is needed in either app for this Hype-only layout. `index.html` and Hype's shell-cache version are standalone-app changes, not shared-player patches.

Row and Vessel were not edited. Their existing `pauseForAssistant` functions/exports remain theirs. Row's exercise preference (`pickMidSetClip(exercise)` / `playMidSetHype(exercise)`) remains untouched. Do not replace either adapter with the canonical Hype file: historical differences already exist and are outside this run. A later shared-code change must produce a targeted diff preserving assistant pause, Row exercise preference, dependency order, mixer integration and offline release identity.

## Defaults and reachability

- Home order is Quick Play, Library (search before tiles), This week. Existing Speeches remains fifth after Mindset, Iron, Faith and Carl; no pillar or hand-picked content was removed or curated.
- Moment, State and Cue keep direct controls; Focus setup is exposed. Its25-minute/audio defaults are unchanged. No segmented gate or time-based card reorder.
- Global Add groups the existing Upload/Record forms. Upload defaults to Carl; title/file are required, classification is optional and collapsed. Recording remains Carl with the existing source/moment defaults. Existing section/subcategory browsing and upload functionality remain reachable; the section upload and recorder were folded into global Add.
- The same form DOM owns each session draft; no new draft key. Closing Add preserves typed input, active recording and preview. Failed upload retains classification. Ordinary navigation away from a section keeps the prior recording-cancellation behavior; closing the Add dialog does not invoke it.
- Curate exposes Titles, Mentalities and Content Ideas even when empty. Existing review and handoff actions remain. Header badges show drafts and pending review-action counts; they are not live announcements. Multiple pending review actions on one clip count separately.
- The search result's primary title/transcript area is a named Play button; Open section is separate. A known pillar with blank mentality opens Untagged. Unknown pillars are not routed into an invalid section. Vision deep links still navigate without playing.

## Verification boundaries and skipped work

Own20 JavaScript selfcheck files plus the existing Python selfcheck pass. Mocked Edge375×812 blocks service workers, replaces cloud/auth, stubs audio/recording, aborts all remote/API requests and uses synthetic local clips only. Checks cover eight tap paths, draft/record preservation, failed upload, primary/secondary search actions, expanded44px controls, keyboard focus/return and player clearance. Screenshot paths/counts/commit pins are in the Codex receipt.

No mixer, sound design, new pillar, clip curation, Instagram pipeline, shared remote player, production data write or new stored shape was implemented. Soft-delete logic is unchanged; no hard-delete path added. Canonical player/mixer identity and existing unit tests establish source preservation, not hardware playback quality.

**Unverified:** real phone and iPhone playback, microphone permissions, codec quality, lock-screen interruption, actual assistant interruption, offline/service-worker behavior and audible mixer balance. Stubbed Edge audio proves interface behavior only. No push, merge or deploy occurred.

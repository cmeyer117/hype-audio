# hype-audio-app

Standalone motivation-audio app — upload short hype clips (Goggins/Dorian-style),
play them back by mentality/moment, filtered by pillar (`iron`/`faith`). This repo
is the canonical copy of `hype-audio.js`, manually re-copied to the `row` repo
whenever it changes (Row's `gym.html` mini-player calls into it). `sync.js` is
deliberately NOT kept in sync with Row's copy -- Row has its own real divergence
(an owner-auth token flow this single-passphrase app doesn't have). Before
overwriting anything in Row from here, check `git log -- <file>` in Row first --
see `hype-audio.js`'s own header comment and Row's `hype-audio.selfcheck.cjs`.

Live: https://hype-audio-app.vercel.app

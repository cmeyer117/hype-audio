// Run with: node sw.selfcheck.js
'use strict';

const { isAudioClipRequest } = require('./sw.js');

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL: ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exit(1);
  }
}

assertEqual(
  isAudioClipRequest('https://vikpcejlyxieguorwysf.supabase.co/storage/v1/object/public/hype-audio/clip_123_abc.mp3'),
  true,
  'a Supabase hype-audio storage URL is treated as an audio clip request'
);
assertEqual(
  isAudioClipRequest('https://hype-audio-app.vercel.app/index.html'),
  false,
  'the app shell HTML is not treated as an audio clip request'
);
assertEqual(
  isAudioClipRequest('https://hype-audio-app.vercel.app/hype-audio.js'),
  false,
  'a core JS file is not treated as an audio clip request'
);
assertEqual(
  isAudioClipRequest('https://vikpcejlyxieguorwysf.supabase.co/storage/v1/object/public/other-bucket/file.mp3'),
  false,
  'a different Supabase storage bucket is not treated as an audio clip request'
);

// stripRangeRequest -- audio elements (Safari especially) issue Range-header
// requests, which would otherwise get cached as partial 206 responses keyed
// by URL and served back for a different (or absent) Range later. These
// clips are short enough that streaming/seek support isn't needed, so the
// fix is to always fetch/cache/serve the complete file.
const { stripRangeRequest } = require('./sw.js');

const rangedRequest = new Request('https://vikpcejlyxieguorwysf.supabase.co/storage/v1/object/public/hype-audio/clip.mp3', {
  headers: { Range: 'bytes=0-1' },
});
const stripped = stripRangeRequest(rangedRequest);
assertEqual(stripped.headers.has('range'), false, 'stripRangeRequest removes the Range header');
assertEqual(stripped.url, rangedRequest.url, 'stripRangeRequest preserves the request URL');

const unrangedRequest = new Request('https://vikpcejlyxieguorwysf.supabase.co/storage/v1/object/public/hype-audio/clip.mp3');
assertEqual(stripRangeRequest(unrangedRequest).headers.has('range'), false, 'stripRangeRequest is a no-op (no Range header) when there was none to begin with');

console.log('sw.selfcheck.js: all assertions passed');

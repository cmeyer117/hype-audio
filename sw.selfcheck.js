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

console.log('sw.selfcheck.js: all assertions passed');

// Mixes each extracted Goggins voice clip with the royalty-free bg-music
// bed, sidechain-ducked so the music drops under his voice and swells in
// the gaps (voice stays loud/dominant, music is felt not heard over him).
// Source: "Motivational Cinematic Inspiring Corporate - Never Give Up
// (No Drums)" by BreakzStudios, Pixabay Content License (free, no
// attribution required) — scripts/assets/bg-music-never-give-up.mp3.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VOICE_DIR = path.join(__dirname, 'output', 'goggins');
const MUSIC_BED = path.join(__dirname, 'assets', 'apalonbeats-dark-cinematic-566684.mp3');
const OUT_DIR = path.join(__dirname, 'output', 'goggins-mixed');
const MANIFEST_IN = path.join(__dirname, 'output', 'goggins-manifest.json');
const MANIFEST_OUT = path.join(__dirname, 'output', 'goggins-mixed-manifest.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

function duration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  return parseFloat(out.toString().trim());
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_IN, 'utf8'));
const outManifest = [];

for (const item of manifest) {
  const voicePath = item.localFile;
  const outName = path.basename(voicePath, '.mp3') + '_mixed.mp3';
  const outPath = path.join(OUT_DIR, outName);

  if (!fs.existsSync(outPath)) {
    const d = duration(voicePath);
    const fadeStart = Math.max(0, d - 1.5);
    console.log('mixing', outName, `(${d.toFixed(1)}s)`);
    // Tuned by measuring mean_volume against voice-alone (voice is nearly
    // continuous shouting, so naive sidechain settings duck music to
    // inaudibility) — this combo gives a measured +5.2dB lift with the
    // limiter (not hard clipping) catching peaks, music audibly swells
    // in gaps, voice stays dominant. Re-tuned for the louder/more dynamic
    // "Dark Cinematic" bed (mean -7.1dB raw vs the old bed's -13.8dB).
    const filter =
      `[1:a]atrim=0:${d},afade=t=in:d=1,afade=t=out:st=${fadeStart}:d=1.5,volume=0.75[music];` +
      `[0:a]volume=1.0[voice];` +
      `[music][voice]sidechaincompress=threshold=0.25:ratio=2.5:attack=5:release=200[ducked];` +
      `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[premix];` +
      `[premix]alimiter=limit=0.95[out]`;
    execFileSync('ffmpeg', [
      '-y', '-i', voicePath, '-stream_loop', '-1', '-i', MUSIC_BED,
      '-filter_complex', filter, '-map', '[out]',
      '-acodec', 'libmp3lame', '-q:a', '2', outPath,
    ], { stdio: 'inherit' });
  }

  outManifest.push({ ...item, localFile: outPath });
}

fs.writeFileSync(MANIFEST_OUT, JSON.stringify(outManifest, null, 2));
console.log(`Done. ${outManifest.length} mixed clips, manifest at ${MANIFEST_OUT}`);

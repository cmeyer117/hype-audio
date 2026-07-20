// Extracts audio-only mp3s for the 31 curated Goggins clips (already
// transcribed in goggins_transcripts.json) into scripts/output/goggins/.
// ponytail: no background-music bed — no music-gen tool available and no
// existing royalty-free track found; add one later if Carl picks a track.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SRC_DIR = 'G:/My Drive/David Goggins';
const TRANSCRIPTS = path.join(SRC_DIR, 'goggins_transcripts.json');
const OUT_DIR = path.join(__dirname, 'output', 'goggins');
const MANIFEST_OUT = path.join(__dirname, 'output', 'goggins-manifest.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

const clips = JSON.parse(fs.readFileSync(TRANSCRIPTS, 'utf8'));
const manifest = [];

for (const clip of clips) {
  const inPath = path.join(SRC_DIR, clip.filename);
  const outName = path.basename(clip.filename, path.extname(clip.filename)) + '.mp3';
  const outPath = path.join(OUT_DIR, outName);

  if (!fs.existsSync(outPath)) {
    console.log('extracting', clip.filename);
    execFileSync('ffmpeg', ['-y', '-i', inPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outPath], { stdio: 'inherit' });
  }

  const title = clip.transcript.trim().split(/\s+/).slice(0, 10).join(' ') + '…';
  manifest.push({
    localFile: outPath,
    title,
    mentality: 'goggins',
    moment: 'pre_workout',
    source_type: 'personal_use',
    transcript: clip.transcript,
  });
}

fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
console.log(`Done. ${manifest.length} clips extracted, manifest at ${MANIFEST_OUT}`);

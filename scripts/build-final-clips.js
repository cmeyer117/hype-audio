// Builds the final curated clip set from curation.json + segment
// transcripts. Goggins clips get trimmed at the voice layer then mixed
// with the music bed; rants keep their baked-in music and are trimmed
// directly. Prints every resolved window so durations can be verified
// before upload.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CUR = JSON.parse(fs.readFileSync(path.join(__dirname, 'curation.json'), 'utf8'));
const GOG_SEG = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'goggins-segments.json'), 'utf8'));
const RANT_SEG = JSON.parse(fs.readFileSync(path.join(__dirname, 'output', 'rants-segments.json'), 'utf8'));
const MUSIC_BED = path.join(__dirname, 'assets', 'apalonbeats-dark-cinematic-566684.mp3');
const OUT_DIR = path.join(__dirname, 'output', 'final-clips');
const MANIFEST_OUT = path.join(__dirname, 'output', 'final-manifest.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');

function findByBase(segList, base) {
  return segList.find((x) => path.basename(x.filename, path.extname(x.filename)) === base);
}

function resolveWindow(entry, trimSpec) {
  const segs = entry.segments;
  let start = 0;
  let end = segs[segs.length - 1].end;
  if (trimSpec) {
    if (trimSpec.start_anchor) {
      const hit = segs.find((s) => norm(s.text).includes(norm(trimSpec.start_anchor)));
      if (!hit) throw new Error(`start_anchor not found in ${entry.filename}: "${trimSpec.start_anchor}"`);
      start = hit.start;
    }
    if (trimSpec.end_anchor) {
      const hits = segs.filter((s) => norm(s.text).includes(norm(trimSpec.end_anchor)));
      if (hits.length === 0) throw new Error(`end_anchor not found in ${entry.filename}: "${trimSpec.end_anchor}"`);
      end = hits[hits.length - 1].end;
    }
  }
  return { start, end };
}

function windowText(entry, start, end) {
  return entry.segments.filter((s) => s.end > start && s.start < end).map((s) => s.text).join(' ');
}

function titleFrom(text) {
  return text.trim().split(/\s+/).slice(0, 10).join(' ') + '…';
}

// The bed ("Dark Cinematic") has a quiet suspense build from 0-10s and
// drops into full power at t=11s (measured via per-second RMS). Time the
// drop to land at ~65% through each clip: long clips open with dry voice,
// the build creeps in mid-clip, the drop hits at the climax. Short clips
// (<~17s to climax) start the bed at a track offset instead so the drop
// still lands near the peak.
const TRACK_DROP = 11;

function trimAndMixGoggins(base, start, end, outPath) {
  const voicePath = path.join(__dirname, 'output', 'goggins', base + '.mp3');
  const d = end - start;
  const fadeStart = Math.max(0, d - 1.5);
  const tClimax = 0.65 * d;
  const tEnter = Math.max(0, tClimax - TRACK_DROP);   // music entry point in the clip
  const trackOffset = Math.max(0, TRACK_DROP - tClimax); // where in the track to start
  const musicDur = d - tEnter;
  const delayMs = Math.round(tEnter * 1000);
  const filter =
    `[0:a]atrim=${start}:${end},asetpts=PTS-STARTPTS,volume=1.0[voice];` +
    `[1:a]atrim=${trackOffset}:${trackOffset + musicDur},asetpts=PTS-STARTPTS,` +
    `afade=t=in:d=2,afade=t=out:st=${Math.max(0, musicDur - 1.5)}:d=1.5,volume=0.75,` +
    `adelay=${delayMs}|${delayMs}[music];` +
    `[music][voice]sidechaincompress=threshold=0.25:ratio=2.5:attack=5:release=200[ducked];` +
    `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[premix];` +
    `[premix]alimiter=limit=0.95[out]`;
  execFileSync('ffmpeg', [
    '-y', '-i', voicePath, '-stream_loop', '-1', '-i', MUSIC_BED,
    '-filter_complex', filter, '-map', '[out]',
    '-acodec', 'libmp3lame', '-q:a', '2', outPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function trimRant(base, start, end, outPath) {
  const srcPath = path.join(__dirname, 'output', 'rants', base + '.mp3');
  execFileSync('ffmpeg', [
    '-y', '-i', srcPath,
    '-af', `atrim=${start}:${end},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, end - start - 1)}:d=1`,
    '-acodec', 'libmp3lame', '-q:a', '2', outPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

const manifest = [];

function processGroup(groupName, group, segList, mixFn) {
  const trims = group.trim || {};
  const bases = [...new Set([...group.keep, ...Object.keys(trims)])];
  for (const base of bases) {
    const entry = findByBase(segList, base);
    if (!entry) throw new Error(`no segments for ${base}`);
    const { start, end } = resolveWindow(entry, trims[base]);
    const dur = end - start;
    const flag = dur < 15 || dur > 100 ? '  <-- CHECK' : '';
    console.log(`${groupName}  ${base}  ${start.toFixed(1)}-${end.toFixed(1)}  (${dur.toFixed(1)}s)${flag}`);
    const id = 'clip_' + base.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const outPath = path.join(OUT_DIR, id + '.mp3');
    if (!fs.existsSync(outPath)) mixFn(base, start, end, outPath);
    const text = windowText(entry, start, end);
    const pillar = (group.faith_pillar || []).includes(base) ? 'faith' : group.pillar_default;
    manifest.push({
      id,
      localFile: outPath,
      title: titleFrom(text),
      mentality: group.mentality,
      pillar,
      moment: 'pre_workout',
      source_type: 'personal_use',
      duration_seconds: Math.round(dur),
    });
  }
}

processGroup('goggins', CUR.goggins, GOG_SEG, trimAndMixGoggins);
processGroup('rants  ', CUR.rants, RANT_SEG, trimRant);

fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
console.log(`\nDone. ${manifest.length} clips in ${OUT_DIR}, manifest at ${MANIFEST_OUT}`);

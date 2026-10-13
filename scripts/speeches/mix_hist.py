"""Mix each dry historic speech with a bed: voice EQ + compression, bed ducked under the voice (sidechain), loudness-normalized."""
import json, subprocess, shutil, sys
from pathlib import Path

HERE = Path(__file__).parent
DRY = HERE / "speeches-hist-dry"
OUT = HERE / "speeches-hist"
OUT.mkdir(exist_ok=True)
LEAD, TAIL = 2.2, 3.5

for jf in sorted(DRY.glob("speech-*.json")):
    meta = json.loads(jf.read_text(encoding="utf-8"))
    n = meta["n"]
    voice = DRY / f"speech-{n}.mp3"
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(voice)],
                           capture_output=True, text=True, check=True)
    dur = float(probe.stdout.strip())
    total = dur + LEAD + TAIL
    bed = HERE / "beds" / ("dark.wav" if meta["reflect"] else "intense.wav")
    gain = 0.30 if meta["reflect"] else 0.38
    fc = (
        f"[0:a]adelay={int(LEAD*1000)}|{int(LEAD*1000)},highpass=f=70,bass=g=3:f=110,"
        f"acompressor=threshold=-20dB:ratio=3:attack=8:release=160:makeup=3,aecho=0.85:0.5:65:0.16,"
        f"apad=whole_dur={total:.2f},aformat=channel_layouts=stereo,asplit=2[v][vsc];"
        f"[1:a]atrim=0:{total:.2f},asetpts=PTS-STARTPTS,volume={gain},afade=t=in:d=1.8,afade=t=out:st={total-3.0:.2f}:d=3.0[b];"
        f"[b][vsc]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=600[bd];"
        f"[v][bd]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[out]"
    )
    dst = OUT / f"speech-{n}.mp3"
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(voice), "-i", str(bed), "-filter_complex", fc,
                        "-map", "[out]", "-t", f"{total:.2f}", "-ac", "2", "-b:a", "128k", str(dst)],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"ffmpeg failed for {n}: {r.stderr[-600:]}")
    meta["seconds"] = round(total)
    (OUT / f"speech-{n}.json").write_text(json.dumps(meta), encoding="utf-8")
    print(n, meta["title"], "->", round(total), "s", round(dst.stat().st_size / 1e6, 2), "MB", "dark" if meta["reflect"] else "intense")

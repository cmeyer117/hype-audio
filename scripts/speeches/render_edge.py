"""Render the five historic speeches with Edge neural voices, line by line, with controlled pauses.
Output: speeches-hist-dry/speech-N.mp3 + .json (same layout mix_hist.py already reads)."""
import asyncio, json, subprocess, tempfile, wave
from pathlib import Path
import numpy as np
import edge_tts

HERE = Path(__file__).parent
DRY = HERE / "speeches-hist-dry"
VOICE = {1: "en-GB-RyanNeural", 2: "en-GB-RyanNeural", 3: "en-GB-RyanNeural",
         4: "en-GB-RyanNeural", 5: "en-GB-RyanNeural"}
SR = 24000


def decode(mp3: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


async def line_audio(text, voice, rate, pitch, tmp, k):
    for attempt in range(3):
        p = tmp / f"l{k}.mp3"
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(p))
            a = decode(p)
            if len(a) > SR * 0.2:
                return a
        except Exception as e:  # noqa: BLE001
            print("retry", k, e)
    raise SystemExit(f"edge-tts failed for line {k}: {text[:40]}")


async def main():
    speeches = json.loads((HERE / "hist-speeches.json").read_text(encoding="utf-8"))
    DRY.mkdir(exist_ok=True)
    only = {int(a) for a in __import__('sys').argv[1:]}
    for s in speeches:
        if only and s['n'] not in only:
            continue
        n, reflect = s["n"], s["reflect"]
        rate, pitch = ("-12%", "-2Hz") if reflect else ("-8%", "-3Hz")
        gap = np.zeros(int(SR * (0.7 if reflect else 0.45)), dtype=np.float32)
        parts = []
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            for k, text in enumerate(s["lines"]):
                parts += [await line_audio(text, VOICE[n], rate, pitch, tmp, k), gap]
        audio = np.concatenate(parts)
        wav = DRY / f"speech-{n}.wav"
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        mp3 = DRY / f"speech-{n}.mp3"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "128k", str(mp3)], check=True)
        wav.unlink()
        secs = round(len(audio) / SR)
        (DRY / f"speech-{n}.json").write_text(json.dumps({"n": n, "title": s["title"], "reflect": reflect, "seconds": secs,
                                                           "text": "\n".join(s["lines"]), "voice": VOICE[n]}), encoding="utf-8")
        print(n, s["title"], VOICE[n], secs, "s")


asyncio.run(main())

"""Kokoro voice enhancement ("chain 3", chosen by Carl 2026-10-13): EQ-match FIR toward Edge Ryan's long-term spectrum,
then highpass + afftdn denoise + gentle compression + air exciter. Used for the Speeches dry voices; the same curve feeds Vision.
Usage: python -I enhance_voice.py <in_dir_with_speech-N.wav+json> <out_dir>   (writes speech-N.mp3 + json copy, NO loudnorm: mixing does that)"""
import json, shutil, subprocess, sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile
from scipy.signal import firwin2, fftconvolve

HERE = Path(__file__).parent
SR = 24000
CURVE = json.loads((HERE / "bm_george-eq-curve.json").read_text(encoding="utf-8"))
FREQS = np.concatenate([[0], CURVE["centers_hz"], [SR / 2]])
GAINS = 10 ** (np.concatenate([[CURVE["gain_db"][0]], CURVE["gain_db"], [CURVE["gain_db"][-1]]]) / 20)
FIR = firwin2(1025, FREQS, GAINS, fs=SR)
CHAIN = ("highpass=f=70,afftdn=nr=10:nf=-48,acompressor=threshold=-22dB:ratio=2.5:attack=5:release=120:makeup=2,"
         "aexciter=amount=2:drive=6:blend=0:freq=5000:ceil=11000")


def enhance(wav_in: Path, mp3_out: Path):
    sr, x = wavfile.read(wav_in)
    assert sr == SR, sr
    x = x.astype(np.float32) / 32768.0
    y = fftconvolve(x, FIR, mode="same").astype(np.float32)
    y *= 0.89 / (np.max(np.abs(y)) + 1e-9)
    tmp = mp3_out.with_suffix(".eq.wav")
    wavfile.write(tmp, SR, (y * 32767).astype("<i2"))
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-af", CHAIN, "-ar", "44100", "-b:a", "160k", str(mp3_out)], check=True)
    finally:
        tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(exist_ok=True)
    for w in sorted(src.glob("speech-*.wav")):
        enhance(w, dst / (w.stem + ".mp3"))
        shutil.copy(w.with_suffix(".json"), dst / (w.stem + ".json"))
        print("enhanced", w.name)

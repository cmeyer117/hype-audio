"""Synthesize an intense (or dark) cinematic bed: sub drone + detuned dark pad + war-drum pulse + noise risers + reverb.
Fully synthetic (no samples), stereo 44.1 kHz WAV. Usage: python -I make_bed.py <out.wav> <seconds> <intense|dark>"""
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
out_path, seconds, mode = sys.argv[1], float(sys.argv[2]), sys.argv[3]
INTENSE = mode == "intense"
n = int(SR * seconds)
t = np.arange(n, dtype=np.float32) / SR
rng = np.random.default_rng(7)


def env_ramp(a, b, start, end):
    """linear ramp from a to b over [start, end] seconds, held outside"""
    return np.interp(t, [0, start, end, seconds], [a, a, b, b]).astype(np.float32)


# --- sub drone: D1 + D2 + A2, slow breathing, saturated for harmonics ---
lfo = 0.75 + 0.25 * np.sin(2 * np.pi * 0.07 * t)
drone = (np.sin(2 * np.pi * 36.71 * t) * 1.0 + np.sin(2 * np.pi * 73.42 * t + 0.6) * 0.55 + np.sin(2 * np.pi * 110.0 * t + 1.3) * 0.25) * lfo
drone = np.tanh(drone * 1.8).astype(np.float32) * 0.5

# --- dark pad: D minor (D3 F3 A3) additive saw stacks, cutoff slowly opens ---
cutoff = env_ramp(300, 1500 if INTENSE else 700, 0, seconds * 0.8)
pad = np.zeros(n, dtype=np.float32)
for f0 in (146.83, 174.61, 220.0, 293.66 if INTENSE else 146.83):
    for detune in (-7, 7):
        f = f0 * 2 ** (detune / 1200)
        phase = rng.uniform(0, 2 * np.pi)
        for h in range(1, 9):
            amp = (1.0 / h) * np.exp(-((h * f / cutoff) ** 2))
            pad += (amp * np.sin(2 * np.pi * f * h * t + phase * h)).astype(np.float32)
pad *= 0.04
pad *= (0.6 + 0.4 * np.sin(2 * np.pi * 0.05 * t + 1.0)).astype(np.float32)
pad *= np.minimum(1.0, t / 4.0)  # swell in

# --- noise riser + air ---
noise = rng.standard_normal(n).astype(np.float32)
air = sosfilt(butter(2, [400, 3000], "bandpass", fs=SR, output="sos"), noise) * 0.02
bed = drone + pad + air.astype(np.float32)

# --- war drums (intense): 66 BPM, boom on 1, medium on 3, soft double on 3.5, risers every 8 bars ---
if INTENSE:
    beat = 60.0 / 66.0
    drums = np.zeros(n, dtype=np.float32)

    def hit(at, vel, base=95.0, low=38.0, decay=0.5):
        i = int(at * SR)
        if i >= n:
            return
        length = int(min(decay * 2.2, 2.0) * SR)
        length = min(length, n - i)
        tt = np.arange(length, dtype=np.float32) / SR
        freq = low + (base - low) * np.exp(-tt * 14)
        body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-tt / decay)
        click = rng.standard_normal(length).astype(np.float32) * np.exp(-tt * 90) * 0.07
        drums[i:i + length] += vel * (body + click).astype(np.float32)

    bar = 0
    at = 2.0
    while at < seconds:
        hit(at, 1.0)                    # beat 1: boom
        hit(at + 2 * beat, 0.65, 85.0)  # beat 3
        hit(at + 2.5 * beat, 0.4, 80.0, 36.0, 0.35)  # soft double
        if bar % 8 == 7:                # every 8th bar: tom roll into the next downbeat
            for k in range(8):
                hit(at + 3 * beat + k * beat / 8, 0.25 + 0.05 * k, 130.0, 70.0, 0.18)
        at += 4 * beat
        bar += 1
    drums = sosfilt(butter(2, 220, "lowpass", fs=SR, output="sos"), drums).astype(np.float32) * 1.4 + sosfilt(butter(2, 700, "lowpass", fs=SR, output="sos"), drums).astype(np.float32) * 0.35
    bed += drums * 0.9
    # riser: filtered noise swelling across each 8-bar phrase
    phrase = 32 * beat
    ph = (t - 2.0) % phrase
    swell = np.clip((ph / phrase) ** 3, 0, 1) * (t > 2.0)
    rise = sosfilt(butter(2, [600, 5000], "bandpass", fs=SR, output="sos"), rng.standard_normal(n).astype(np.float32)) * swell * 0.05
    bed += rise.astype(np.float32)

# --- reverb: synthetic exponential-decay noise IR, stereo, 28% wet ---
ir_len = int(2.6 * SR)
tt = np.arange(ir_len, dtype=np.float32) / SR
dry = bed
chans = []
for c in range(2):
    ir = rng.standard_normal(ir_len).astype(np.float32) * np.exp(-tt * 2.2)
    ir = sosfilt(butter(2, 2500, "lowpass", fs=SR, output="sos"), ir).astype(np.float32)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    wet = fftconvolve(dry, ir)[:n].astype(np.float32)
    # slight stereo difference from a few ms delay
    wet = np.roll(wet, c * 11)
    chans.append(dry * 0.72 + wet * 0.55)
stereo = np.stack(chans, axis=1)

# --- master: remove DC/rumble below 25 Hz, soft clip, normalize to -3 dBFS peak ---
stereo = sosfilt(butter(2, 25, "highpass", fs=SR, output="sos"), stereo, axis=0)
stereo = np.tanh(stereo * 1.2)
stereo *= (10 ** (-3 / 20)) / (np.max(np.abs(stereo)) + 1e-9)

pcm = (stereo * 32767).astype("<i2")
import wave
with wave.open(out_path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out_path, mode, round(seconds), "s")

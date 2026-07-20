import json, os

FOLDER = r"G:\My Drive\David Goggins"
TRANSCRIPTS = os.path.join(FOLDER, "goggins_transcripts.json")

MISSING = [
    "ScreenRecording_06-27-2025 15-41-37_1.mp4",
    "ScreenRecording_06-27-2025 15-50-04_1.mp4",
    "ScreenRecording_06-24-2025 17-51-37_1.mp4",
    "ScreenRecording_06-24-2025 17-39-24_1.mp4",
    "ScreenRecording_06-27-2025 15-26-37_1.mp4",
    "ScreenRecording_06-27-2025 15-15-47_1.mp4",
    "ScreenRecording_06-27-2025 15-18-49_1.mp4",
    "ScreenRecording_06-24-2025 16-16-12_1.mp4",
    "ScreenRecording_06-24-2025 15-39-14_1.mp4",
    "ScreenRecording_06-24-2025 14-57-25_1.mp4",
    "ScreenRecording_06-24-2025 15-35-41_1.mp4",
    "ScreenRecording_06-24-2025 13-51-33_1.mp4",
    "ScreenRecording_06-24-2025 13-44-08_1.mp4",
    "ScreenRecording_06-24-2025 13-47-52_1.mp4",
    "ScreenRecording_06-24-2025 13-41-22_1.mp4",
]

def main():
    import whisper
    model = whisper.load_model("base")

    with open(TRANSCRIPTS, "r", encoding="utf-8") as fh:
        results = json.load(fh)
    done = {r["filename"] for r in results}

    for i, filename in enumerate(MISSING):
        if filename in done:
            continue
        path = os.path.join(FOLDER, filename)
        print(f"[{i+1}/{len(MISSING)}] transcribing {filename}", flush=True)
        out = model.transcribe(path, fp16=False)
        results.append({
            "filename": filename,
            "title": os.path.splitext(filename)[0],
            "folder": "David Goggins",
            "transcript": out["text"].strip(),
            "duration_seconds": round(out.get("segments", [{}])[-1].get("end", 0)) if out.get("segments") else None,
            "transcribed_at": __import__("datetime").datetime.now().isoformat(),
        })
        with open(TRANSCRIPTS, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)

    print(f"Done. {len(results)} total transcripts.")

if __name__ == "__main__":
    main()

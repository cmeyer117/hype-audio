import json, os, sys, glob

FOLDER = r"G:\My Drive\Mindset rants"
OUTPUT = os.path.join(FOLDER, "mindset_rants_transcripts.json")

def main():
    import whisper
    model = whisper.load_model("base")

    files = sorted(
        f for f in glob.glob(os.path.join(FOLDER, "*"))
        if f.lower().endswith((".mp4", ".mov"))
    )

    results = []
    if os.path.exists(OUTPUT):
        with open(OUTPUT, "r", encoding="utf-8") as fh:
            results = json.load(fh)
    done = {r["filename"] for r in results}

    for i, path in enumerate(files):
        filename = os.path.basename(path)
        if filename in done:
            continue
        print(f"[{i+1}/{len(files)}] transcribing {filename}", flush=True)
        try:
            out = model.transcribe(path, fp16=False)
        except Exception as e:
            print(f"  FAILED: {e}", flush=True)
            continue
        results.append({
            "filename": filename,
            "title": os.path.splitext(filename)[0],
            "folder": "Mindset rants",
            "transcript": out["text"].strip(),
            "duration_seconds": round(out.get("segments", [{}])[-1].get("end", 0)) if out.get("segments") else None,
        })
        with open(OUTPUT, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)

    print(f"Done. {len(results)} transcripts in {OUTPUT}")

if __name__ == "__main__":
    main()

import json, os, sys, glob

def main():
    folder = sys.argv[1]
    out_path = sys.argv[2]
    exts = (".mp3", ".mp4", ".mov")

    import whisper
    model = whisper.load_model("base")

    files = sorted(f for f in glob.glob(os.path.join(folder, "*")) if f.lower().endswith(exts))

    results = []
    if os.path.exists(out_path):
        with open(out_path, "r", encoding="utf-8") as fh:
            results = json.load(fh)
    done = {r["filename"] for r in results}

    for i, path in enumerate(files):
        filename = os.path.basename(path)
        if filename in done:
            continue
        print(f"[{i+1}/{len(files)}] {filename}", flush=True)
        out = model.transcribe(path, fp16=False)
        segments = [{"start": round(s["start"], 1), "end": round(s["end"], 1), "text": s["text"].strip()} for s in out["segments"]]
        results.append({
            "filename": filename,
            "transcript": out["text"].strip(),
            "duration_seconds": round(segments[-1]["end"]) if segments else 0,
            "segments": segments,
        })
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)

    print(f"Done. {len(results)} files in {out_path}")

if __name__ == "__main__":
    main()

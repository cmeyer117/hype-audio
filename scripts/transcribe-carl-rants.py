# Transcribes carl-pillar hype-audio clips missing transcript_text, using
# local Whisper (zero API cost). Adapted from instagram-cleanup's
# fetch-missing-transcripts.py, with two differences: joins on the clip's
# stable `id` (not the old title-slug hack), and does NOT exclude the carl
# mentality -- that exclusion is exactly the gap this script closes.
# See docs/superpowers/specs/2026-08-17-rant-engine-design.md.
#
# Push-back uses the plain anon/publishable key, not the service-role key --
# app_state's RLS already grants anon read/write for key='hype-audio'
# (confirmed live), matching hype-audio-app/scripts/update-existing-clips.js.
import json
import subprocess
import tempfile
import urllib.request
from pathlib import Path

SUPABASE_URL = "https://vikpcejlyxieguorwysf.supabase.co"
SUPABASE_KEY = "sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv"
APP_KEY = "hype-audio"

HERE = Path(__file__).parent
TRANSCRIPT_DIR = HERE / "carl-rant-transcripts"
TRANSCRIPT_DIR.mkdir(exist_ok=True)


def fetch_json(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    headers = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}
    row = fetch_json(
        f"{SUPABASE_URL}/rest/v1/app_state?key=eq.{APP_KEY}&select=data",
        headers,
    )
    if not row:
        print("No app_state row found for key=hype-audio.")
        return
    clips = row[0]["data"]["hype_audio"]

    missing = [
        c for c in clips
        if c.get("pillar") == "carl"
        and not c.get("deleted")
        and not (c.get("transcript_text") or "").strip()
    ]
    print(f"{len(missing)} carl clips missing transcript_text")

    ok, err = 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for i, clip in enumerate(missing, 1):
            clip_id = clip["id"]
            url = clip.get("storage_url")
            if not url:
                print(f"  [{i}/{len(missing)}] {clip_id} -> no storage_url, skipping")
                err += 1
                continue

            out_json = TRANSCRIPT_DIR / f"{clip_id}.json"
            if not out_json.exists():
                audio_path = tmp_path / f"{clip_id}.mp3"
                try:
                    urllib.request.urlretrieve(url, audio_path)
                except Exception as e:
                    print(f"  [{i}/{len(missing)}] {clip_id} -> download error: {str(e)[:100]}")
                    err += 1
                    continue

                subprocess.run(
                    ["whisper", str(audio_path), "--model", "base", "--output_format", "json",
                     "--output_dir", str(TRANSCRIPT_DIR), "--fp16", "False"],
                    capture_output=True, text=True, timeout=180,
                )
                # whisper names its output after the input file's stem
                produced = TRANSCRIPT_DIR / f"{audio_path.stem}.json"
                if produced.exists() and produced != out_json:
                    produced.rename(out_json)

            if not out_json.exists():
                print(f"  [{i}/{len(missing)}] {clip_id} -> transcription failed")
                err += 1
                continue

            transcript = json.loads(out_json.read_text(encoding="utf-8"))["text"].strip()
            clip["transcript_text"] = transcript
            ok += 1
            if i % 5 == 0:
                print(f"  [{i}/{len(missing)}] done")

    if ok > 0:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/app_state?on_conflict=key",
            data=json.dumps({"key": APP_KEY, "data": {"hype_audio": clips}}).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
            method="POST",
        )
        urllib.request.urlopen(req)

    print(f"\nDone. {ok} transcribed, {err} errors.")


if __name__ == "__main__":
    main()

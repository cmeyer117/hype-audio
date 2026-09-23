# Transcribes carl-pillar hype-audio clips missing transcript_text, using
# local Whisper (zero API cost). Adapted from instagram-cleanup's
# fetch-missing-transcripts.py, with two differences: joins on the clip's
# stable `id` (not the old title-slug hack), and does NOT exclude the carl
# mentality -- that exclusion is exactly the gap this script closes.
# See docs/superpowers/specs/2026-08-17-rant-engine-design.md.
#
# Rant-capture flow (see index.html's record form + HypeAudio.confirmMentality):
# the record form allows a blank `mentality` at save time. For any clip whose
# transcript this script just filled in and whose `mentality` is still blank,
# it also writes `suggested_mentality` -- a plain keyword-count guess against
# the vocabulary of mentalities Carl has already used elsewhere in the
# library. This is a suggestion only, same non-goal as the pillar
# classification note above: no AI, no auto-categorization. Carl reviews and
# confirms (or edits) it by hand in the app before it ever becomes the real
# `mentality`.
#
# Push-back uses the plain anon/publishable key, not the service-role key --
# app_state's RLS already grants anon read/write for key='hype-audio'
# (confirmed live), matching hype-audio-app/scripts/update-existing-clips.js.
import json
import re
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

SUPABASE_URL = "https://vikpcejlyxieguorwysf.supabase.co"
SUPABASE_KEY = "sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv"
APP_KEY = "hype-audio"

HERE = Path(__file__).parent
# Created in main(), not at import -- transcribe-carl-rants.selfcheck.py
# imports this module for its pure functions and must not touch the disk.
TRANSCRIPT_DIR = HERE / "carl-rant-transcripts"


def fetch_json(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


# Whole-word, case-insensitive count of each known mentality's own name
# within the transcript -- deliberately simple (no NLP/embeddings/API calls),
# matching this script's existing zero-cost, fully-local shape. Ties go to
# whichever mentality was seen first in `known_mentalities` (a stable,
# reproducible order, not a hidden random pick). Returns None rather than a
# low-confidence guess when nothing in the transcript matches at all.
def suggest_mentality(transcript, known_mentalities):
    best, best_count = None, 0
    for mentality in known_mentalities:
        if not mentality:
            continue
        count = len(re.findall(r"\b" + re.escape(mentality) + r"\b", transcript, re.IGNORECASE))
        if count > best_count:
            best, best_count = mentality, count
    return best


# The per-clip write, split out of main() so it's testable without Whisper
# or the network. Bumps the clip's own `updated_at` (ms epoch, same unit
# the app's Date.now() writes): sync.js's mergeArrays is last-write-wins
# on that field per entry, so without the bump any device whose local copy
# of this clip is newer -- a play_count increment or a favorite toggle is
# enough -- would silently discard the transcript + suggestion on its next
# merge and push the stale copy back over the top. Never writes the real
# `mentality`; that stays the app's hand-confirmed step (confirmMentality).
def apply_transcription(clip, transcript, known_mentalities, now_ms):
    clip["transcript_text"] = transcript
    if not (clip.get("mentality") or "").strip():
        suggestion = suggest_mentality(transcript, known_mentalities)
        if suggestion:
            clip["suggested_mentality"] = suggestion
    clip["updated_at"] = now_ms


def main():
    TRANSCRIPT_DIR.mkdir(exist_ok=True)
    headers = {"apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY}
    row = fetch_json(
        f"{SUPABASE_URL}/rest/v1/app_state?key=eq.{APP_KEY}&select=data",
        headers,
    )
    if not row:
        print("No app_state row found for key=hype-audio.")
        return
    clips = row[0]["data"]["hype_audio"]

    # The suggestion vocabulary: every mentality Carl has already hand-picked
    # anywhere in the library (not just carl-pillar) -- a rant can reasonably
    # reuse a mentality word from any other pillar (e.g. "discipline",
    # "goggins"), and this is only ever a suggestion Carl confirms by hand.
    known_mentalities = sorted({
        (c.get("mentality") or "").strip().lower()
        for c in clips
        if not c.get("deleted") and (c.get("mentality") or "").strip()
    })

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
            apply_transcription(clip, transcript, known_mentalities, int(time.time() * 1000))
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

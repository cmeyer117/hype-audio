# Run with: python scripts/transcribe-carl-rants.selfcheck.py
# Same plain-assert shape as the repo's *.selfcheck.js files -- no test
# framework. Covers the two pure pieces of transcribe-carl-rants.py so the
# Whisper/network parts stay out of the test entirely.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import importlib

mod = importlib.import_module("transcribe-carl-rants")
suggest_mentality = mod.suggest_mentality
apply_transcription = mod.apply_transcription


def assert_equal(actual, expected, label):
    if actual != expected:
        print(f"FAIL: {label}\n  expected: {expected!r}\n  actual:   {actual!r}")
        sys.exit(1)


KNOWN = ["carl", "discipline", "faith", "goggins", "training"]

# suggest_mentality -- whole-word keyword count, highest wins
assert_equal(
    suggest_mentality("Discipline. Discipline every day. Faith too.", KNOWN),
    "discipline",
    "the mentality mentioned most often wins",
)
assert_equal(
    suggest_mentality("Nothing in here matches at all.", KNOWN),
    None,
    "no keyword hit returns None rather than a low-confidence guess",
)
assert_equal(
    suggest_mentality("Faithful people keep faithfulness.", KNOWN),
    None,
    "matching is whole-word: 'faithful' does not count as 'faith'",
)
assert_equal(
    suggest_mentality("faith and discipline", KNOWN),
    "discipline",
    "a tie goes to whichever known mentality comes first in the list (stable, not random)",
)
assert_equal(
    suggest_mentality("Some text", ["", "faith"]),
    None,
    "a blank entry in the vocabulary is skipped instead of matching everything",
)

# apply_transcription -- the per-clip mutation main() performs. Must bump the
# clip's own updated_at: sync.js's mergeArrays is last-write-wins on that
# field, so without the bump any device whose local copy is newer (a play
# count or favorite toggle) silently discards the transcript + suggestion
# on merge and pushes the stale copy back over the top.
NOW = 1_700_000_000_000

clip = {"id": "a", "pillar": "carl", "mentality": "", "updated_at": 1}
apply_transcription(clip, "Discipline is the whole game.", KNOWN, NOW)
assert_equal(clip["transcript_text"], "Discipline is the whole game.", "writes transcript_text")
assert_equal(clip["suggested_mentality"], "discipline", "suggests a mentality when the clip's own is blank")
assert_equal(clip["mentality"], "", "never writes the real mentality field -- that stays a hand-confirmed step in the app")
assert_equal(clip["updated_at"], NOW, "bumps the clip's per-entry updated_at so the merge keeps this write")

tagged = {"id": "b", "pillar": "carl", "mentality": "carl", "updated_at": 1}
apply_transcription(tagged, "Discipline discipline discipline.", KNOWN, NOW)
assert_equal(tagged["transcript_text"], "Discipline discipline discipline.", "still transcribes a hand-tagged clip")
assert_equal("suggested_mentality" in tagged, False, "a clip that already has a mentality gets no suggestion")
assert_equal(tagged["updated_at"], NOW, "the transcript-only write also bumps updated_at")

no_hit = {"id": "c", "pillar": "carl", "mentality": None, "updated_at": 1}
apply_transcription(no_hit, "Nothing matches here.", KNOWN, NOW)
assert_equal("suggested_mentality" in no_hit, False, "no keyword hit leaves suggested_mentality unset")
assert_equal(no_hit["updated_at"], NOW, "updated_at is bumped even when nothing could be suggested")

print("transcribe-carl-rants.selfcheck.py: all assertions passed")

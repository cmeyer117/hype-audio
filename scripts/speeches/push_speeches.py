"""Push rendered speeches (speech-N.mp3 + speech-N.json in <dir>) into hype-audio's Speeches pillar as clip_speeches_<prefix>_<N>.
Usage: python -I push_speeches.py <dir> <prefix> [--apply]  (dry run unless --apply).
Uploads happen before the CAS write on app_state.updated_at, so a conflict leaves the mp3s in Storage but appends nothing; re-run.
Ids are deterministic, so a re-run skips clips already present."""
import json, re, sys, time, urllib.request, urllib.parse, datetime
from pathlib import Path

HERE = Path(__file__).parent
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SRC = HERE / (ARGS[0] if ARGS else "speeches-audio")
PREFIX = ARGS[1] if len(ARGS) > 1 else "original"
APPLY = "--apply" in sys.argv
URL = "https://vikpcejlyxieguorwysf.supabase.co"
env = Path(r"C:\Users\gregm\jarvis-embed\.env").read_text(encoding="utf-8")
KEY = re.search(r"^SUPABASE_SERVICE_ROLE_KEY=(.+)$", env, re.M).group(1).strip().strip('"').strip("'")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def call(method, path, body=None, headers=None, raw=False):
    req = urllib.request.Request(URL + path, data=body, method=method, headers={**H, **(headers or {})})
    with urllib.request.urlopen(req) as r:
        d = r.read()
        return d if raw else (json.loads(d) if d else None)


row = call("GET", "/rest/v1/app_state?key=eq.hype-audio&select=data,updated_at")[0]
token, clips = row["updated_at"], row["data"]["hype_audio"]
existing = {c["id"] for c in clips}
new = []
for jf in sorted(SRC.glob("speech-*.json")):
    d = json.loads(jf.read_text(encoding="utf-8"))
    cid = f"clip_speeches_{PREFIX}_{d['n']}"
    mp3 = SRC / f"speech-{d['n']}.mp3"
    if cid in existing:
        print("skip (present)", cid)
        continue
    print(cid, d["title"], "reflect" if d["reflect"] else "charge", d["seconds"], "s", round(mp3.stat().st_size / 1e6, 2), "MB")
    if not APPLY:
        continue
    name = cid + ".mp3"
    call("POST", f"/storage/v1/object/hype-audio/{name}", mp3.read_bytes(), {"Content-Type": "audio/mpeg", "x-upsert": "true"}, raw=True)
    new.append({
        "id": cid, "title": d["title"], "moment": "", "pillar": "speeches",
        "mentality": "reflect" if d["reflect"] else "charge", "delivery_role": "motivational_speech",
        "created_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "play_count": 0, "updated_at": int(time.time() * 1000), "source_type": "original",
        "storage_url": f"{URL}/storage/v1/object/public/hype-audio/{name}",
        "transcript_text": d["text"], "duration_seconds": float(d["seconds"]),
    })
if not APPLY:
    print("DRY RUN")
    sys.exit(0)
if not new:
    sys.exit("nothing to write")
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+00:00"
body = json.dumps({"key": "hype-audio", "data": {**row["data"], "hype_audio": clips + new}, "updated_at": stamp}).encode()
res = call("PATCH", "/rest/v1/app_state?key=eq.hype-audio&updated_at=eq." + urllib.parse.quote(token), body,
           {"Content-Type": "application/json", "Prefer": "return=representation"})
if not res:
    sys.exit("CONFLICT: row changed since read; nothing appended. Re-run.")
print("appended", len(new))

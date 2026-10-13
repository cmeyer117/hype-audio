"""Tombstone specific clip ids (same fields as the app's deleteClip). Usage: python -I tombstone_ids.py id1 id2 ... [--apply]. CAS write."""
import json, re, sys, time, urllib.request, urllib.parse, datetime
from pathlib import Path

APPLY = "--apply" in sys.argv
IDS = [a for a in sys.argv[1:] if not a.startswith("--")]
URL = "https://vikpcejlyxieguorwysf.supabase.co"
env = Path(r"C:\Users\gregm\jarvis-embed\.env").read_text(encoding="utf-8")
KEY = re.search(r"^SUPABASE_SERVICE_ROLE_KEY=(.+)$", env, re.M).group(1).strip().strip('"').strip("'")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(URL + path, data=body, method=method, headers={**H, **(headers or {})})
    with urllib.request.urlopen(req) as r:
        d = r.read()
        return json.loads(d) if d else None


row = call("GET", "/rest/v1/app_state?key=eq.hype-audio&select=data,updated_at")[0]
token, clips = row["updated_at"], row["data"]["hype_audio"]
now = int(time.time() * 1000)
hit = []
for c in clips:
    if c["id"] in IDS and not c.get("deleted"):
        c["deleted"], c["deleted_at"], c["updated_at"] = True, now, now
        hit.append(c["id"])
print("tombstone:", hit, "| not found/already deleted:", sorted(set(IDS) - set(hit)))
if not APPLY or not hit:
    sys.exit(0)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+00:00"
body = json.dumps({"key": "hype-audio", "data": {**row["data"], "hype_audio": clips}, "updated_at": stamp}).encode()
res = call("PATCH", "/rest/v1/app_state?key=eq.hype-audio&updated_at=eq." + urllib.parse.quote(token), body,
           {"Content-Type": "application/json", "Prefer": "return=representation"})
if not res:
    sys.exit("CONFLICT: row changed since read; nothing written. Re-run.")
print("written")

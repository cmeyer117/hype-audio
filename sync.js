// =============================================================
// Shared cloud-sync helper. Each page calls initCloudSync({...}).
// Replace the two placeholders with your Supabase project URL +
// publishable key (same ones you used in topbar.js/gym.html).
// =============================================================
(function () {
  'use strict';
  const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_EvWPtfW1FBW5Vf-H6w0yHw_PcXK4imv';

  window.initCloudSync = function (config) {
    const appKey = config && config.appKey;
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;
    if (!appKey || !window.supabase) return;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return;

    let supa = null, pushTimer = null, suppressSync = false, lastSyncedJson = null;
    // Nothing may push until the initial fetch has round-tripped successfully
    // at least once. Without this, a page that never got a chance to pull
    // real data (slow network, tab closed early) could still push its
    // legitimately-empty local state on tab-close and overwrite good remote
    // data with nothing -- this happened for real 2026-07-25 (see SESSION_LOG).
    let syncReady = false;

    function matches(k) {
      if (!k) return false;
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function collect() {
      const out = {};
      for (const k of listAllKeys()) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
      }
      return out;
    }
    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      origSet(k, v);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      origRemove(k);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };
    function mergeArrays(remoteArr, localArr) {
      const byKey = new Map();
      for (const entry of [...remoteArr, ...localArr]) {
        const key = entry && typeof entry === 'object' && 'id' in entry ? entry.id : JSON.stringify(entry);
        const existing = byKey.get(key);
        if (!existing) { byKey.set(key, entry); continue; }
        // A tombstone (entry.deleted) always wins over a non-tombstoned
        // duplicate — a delete that hasn't round-tripped to this side yet
        // shouldn't get merged away.
        const existingDeleted = !!(existing && existing.deleted);
        const entryDeleted = !!(entry && entry.deleted);
        if (entryDeleted && !existingDeleted) { byKey.set(key, entry); continue; }
        if (existingDeleted && !entryDeleted) continue;
        // Otherwise last-write-wins by updated_at (a plain "remote wins"
        // silently clobbered any local edit -- e.g. a favorite toggle --
        // that hadn't round-tripped yet, including from a second writer
        // like Row's mini-player sharing this same key). Missing
        // updated_at (older entries) sorts as oldest.
        const existingTs = (existing && existing.updated_at) || 0;
        const entryTs = (entry && entry.updated_at) || 0;
        if (entryTs > existingTs) byKey.set(key, entry);
      }
      return Array.from(byKey.values());
    }
    function applyRemote(remote) {
      if (!remote || typeof remote !== 'object') return false;
      suppressSync = true;
      let changed = false;
      // True when the merged result pulls in a local-only entry the server
      // hasn't seen yet (e.g. an offline edit made before this fetch/realtime
      // payload landed). Both call sites set lastSyncedJson to the raw remote
      // payload *before* calling applyRemote, so without this the merged-in
      // local data would never get pushed back until some unrelated key
      // happened to change later -- confirmed real via Codex audit 2026-08-20.
      let divergesFromRemote = false;
      try {
        for (const k of Object.keys(remote)) {
          if (!matches(k)) continue;
          let incomingValue = remote[k];
          if (Array.isArray(incomingValue)) {
            let localValue = [];
            try { localValue = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
            if (Array.isArray(localValue)) incomingValue = mergeArrays(incomingValue, localValue);
          }
          const incoming = JSON.stringify(incomingValue);
          if (incoming !== JSON.stringify(remote[k])) divergesFromRemote = true;
          const local = localStorage.getItem(k);
          if (local !== incoming) { try { origSet(k, incoming); changed = true; } catch (e) {} }
        }
      } finally { suppressSync = false; }
      if (changed && typeof onApplied === 'function') { try { onApplied(); } catch (e) {} }
      if (divergesFromRemote) schedulePush();
      return changed;
    }
    // Once a synced key has ever existed in localStorage, a push where NONE
    // of them exist any more (the key(s) fully removed, not just emptied)
    // is always a stale/corrupted local state, never a legitimate user
    // action -- no consumer of this file has a "delete the whole key"
    // feature, only per-entry edits/deletes that leave the key itself in
    // place. This is the second half of the syncReady fix above: syncReady
    // only guards the window before the first successful sync, but a local
    // clear (e.g. a browser dev-tools command) *after* a successful sync
    // leaves syncReady permanently true while collect() now returns nothing
    // -- confirmed to actually happen, wiping production data a second time
    // on 2026-07-25 even with the syncReady guard already in place.
    // Deliberately NOT checking "is every value's own content empty" (e.g.
    // an array that's legitimately shrunk to zero items) -- that's a real,
    // valid state a consumer's own delete feature can produce.
    function isTrivial(state) { return Object.keys(state).length === 0; }
    // A push failure used to be silently swallowed with no retry -- if
    // nothing else touched a synced key afterward (e.g. the user backgrounds
    // the app right after the write that mattered), the change could sit
    // unsynced indefinitely with zero indication anything was wrong.
    // Confirmed to actually happen 2026-08-18: a content-idea "sent" flag
    // never round-tripped for ~10 hours. Pure so it's unit-testable the same
    // way mergeArrays is (see sync.selfcheck.js) -- returns the ms to wait
    // before the next immediate retry, or null once attempts are exhausted
    // (caller then falls back to one longer-delay follow-up push instead of
    // giving up silently). Not a full persistent retry queue -- that would
    // be over-engineering for a single-user app.
    function nextRetryDelayMs(attempt) {
      return attempt < 2 ? 500 * (attempt + 1) : null;
    }
    // Pure state->display mapping for the owner-facing status indicator
    // (index.html renders whatever this returns). Kept separate from the
    // state tracking below so it's unit-testable the same way mergeArrays
    // and nextRetryDelayMs are (see sync.selfcheck.js).
    function computeSyncStatus(s) {
      if (s.initFailed) return 'offline';
      if (s.pushInFlight) return 'saving';
      if (s.retrying) return 'retrying';
      return 'synced';
    }
    const statusState = { initFailed: false, pushInFlight: false, retrying: false };
    let lastSyncedAt = null;
    const onStatusChange = config && config.onStatusChange;
    function updateStatus() {
      if (typeof onStatusChange === 'function') {
        try { onStatusChange(computeSyncStatus(statusState), lastSyncedAt); } catch (e) {}
      }
    }
    async function pushNow(attempt) {
      attempt = attempt || 0;
      if (!supa || !syncReady) return;
      const state = collect();
      if (isTrivial(state)) return;
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      statusState.pushInFlight = true;
      updateStatus();
      // supa.from(...).upsert(...) returns a PostgrestFilterBuilder -- a
      // thenable, not a real Promise -- so it has no .catch() method.
      // Chaining .catch() directly on it (an earlier "simplification" here)
      // threw a synchronous TypeError before the request was ever sent,
      // which silently broke every push. Confirmed live 2026-08-18 via
      // temporary console logging (a genuine edit's write never reached
      // Supabase, no console output, until the real exception surfaced).
      // try/catch around a proper await is the safe pattern for these
      // builders.
      let error;
      try {
        ({ error } = await supa.from('app_state').upsert(
          { key: appKey, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        ));
      } catch (e) {
        error = e;
      }
      statusState.pushInFlight = false;
      if (!error) {
        lastSyncedJson = json;
        lastSyncedAt = Date.now();
        statusState.retrying = false;
        updateStatus();
        return;
      }
      statusState.retrying = true;
      updateStatus();
      // Route the retry/fallback timer through pushTimer (not a bare
      // setTimeout) so schedulePush's clearTimeout can still supersede a
      // pending retry with a fresh push when a new local edit arrives --
      // otherwise the debounce it exists to enforce is defeated and two
      // pushNow calls can end up in flight at once.
      const delay = nextRetryDelayMs(attempt);
      if (delay !== null) {
        pushTimer = setTimeout(() => pushNow(attempt + 1), delay);
      } else {
        pushTimer = setTimeout(schedulePush, 30000);
      }
    }
    function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 250); }
    // Guards against collect()+JSON.stringify running repeatedly for one
    // real exit -- beforeunload/pagehide/visibilitychange can all fire in
    // quick succession for a single tab-close, and visibilitychange alone
    // can fire repeatedly on mobile (app-switcher taps, lock/unlock).
    let lastFlushAt = 0;
    function flushOnUnload() {
      if (!syncReady) return;
      const now = Date.now();
      if (now - lastFlushAt < 1000) return;
      lastFlushAt = now;
      const state = collect();
      if (isTrivial(state)) return;
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      // Only mark synced once the response actually comes back ok -- a
      // silently-failed keepalive push used to mark itself synced anyway,
      // which meant a later successful pushNow() would see json ===
      // lastSyncedJson and skip the write for good. That's the exact
      // failure class this file exists to close, and the new
      // visibilitychange listener made this path fire far more often (any
      // backgrounding, not just real teardown) -- a background tab keeps
      // running JS, so waiting for the real response here is safe, unlike
      // a true beforeunload/pagehide teardown where the tab is gone either
      // way and this distinction can't matter.
      try {
        fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: appKey, data: state, updated_at: new Date().toISOString() }),
          keepalive: true,
        }).then((resp) => { if (resp.ok) { lastSyncedJson = json; lastSyncedAt = Date.now(); statusState.retrying = false; updateStatus(); } }).catch(() => {});
      } catch (e) {}
    }
    (async function init() {
      supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      try {
        const { data, error } = await supa.from('app_state').select('data').eq('key', appKey).maybeSingle();
        if (!error) {
          syncReady = true;
          if (data && data.data && Object.keys(data.data).length > 0) {
            lastSyncedJson = JSON.stringify(data.data);
            lastSyncedAt = Date.now();
            applyRemote(data.data);
          } else if (Object.keys(collect()).length > 0) {
            schedulePush();
          }
          updateStatus();
        } else {
          statusState.initFailed = true;
          updateStatus();
        }
      } catch (e) {
        statusState.initFailed = true;
        updateStatus();
      }
      supa.channel('app_state_' + appKey)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_state', filter: 'key=eq.' + appKey,
        }, (payload) => {
          if (!payload.new || !payload.new.data) return;
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastSyncedJson) return;
          lastSyncedJson = incoming;
          applyRemote(payload.new.data);
        })
        .subscribe();
    })();
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    // beforeunload/pagehide are unreliable on mobile Safari/PWAs for the
    // common real-world exit -- backgrounding the app (home button, app
    // switcher, screen lock) rather than a full page navigation/close.
    // visibilitychange -> 'hidden' fires reliably for that case and is the
    // recommended mobile-safe signal for "flush before we might not get
    // another chance."
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOnUnload();
    });
    window.addEventListener('storage', (e) => { if (e.key && matches(e.key)) schedulePush(); });
  };

  // weekly-recap.js's optional workoutDates input only ever needs the set of
  // training-day dates out of Row's po-coach app_state row, not the full
  // workout payload. Postgrest's JSON path operator narrows that
  // server-side (data->po_coach_v1->sessions) instead of shipping Row's
  // whole cross-app blob just to read its keys -- same least-privilege
  // pattern as Vessel's vesselFetchRowWorkoutDates() (vessel/vessel-sync.js).
  window.hypeFetchRowWorkoutDates = async function () {
    if (!window.supabase) return new Set();
    const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    // Codex review 2026-08-21: a stalled (not rejected) request used to hang
    // renderWeeklyRecap() indefinitely -- a timeout degrades to the same
    // empty-state fallback a real "no data" response already produces.
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ data: null }), 3000));
    const { data } = await Promise.race([
      supa.from('app_state').select('sessions:data->po_coach_v1->sessions').eq('key', 'po-coach').maybeSingle(),
      timeout,
    ]);
    return new Set(Object.keys(data?.sessions ?? {}));
  };
})();

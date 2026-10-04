// hype-cas-write.js — compare-and-swap write of the shared app_state row. No DOM.
// Codex audit 2026-10-03 (P1): sync.js replaced the whole shared row with an unconditional upsert after a
// pull+merge, so a writer landing between that read and the write was dropped. The write is now conditional
// on app_state.updated_at (the version this device last merged); a conflict means "pull, merge, retry".
// Same contract as vessel-sync.js (commit 1fd5fea). No schema change: updated_at is the version token.
(function () {
  'use strict';

  // ISO stamp strictly after the previous token, so the stored value always moves even if this device's clock
  // is behind or equal to the last writer's.
  function nextStamp(prevToken, nowMs) {
    var n = nowMs == null ? Date.now() : nowMs;
    var p = prevToken ? Date.parse(prevToken) : NaN;
    return new Date(isNaN(p) ? n : Math.max(n, p + 1)).toISOString();
  }

  // Resolves { status: 'ok', token } | { status: 'conflict' } | { status: 'error', error, httpStatus }. Never throws, and
  // 'conflict' is the only outcome that means "someone else wrote first". token = null means no cloud row was
  // seen, so this is an insert, not an upsert (23505 = a row appeared since our read).
  async function casWrite(supa, key, data, token, nowMs) {
    var row = { key: key, data: data, updated_at: nextStamp(token, nowMs) };
    var res;
    try {
      res = token
        ? await supa.from('app_state').update(row).eq('key', key).eq('updated_at', token).select('updated_at')
        : await supa.from('app_state').insert(row).select('updated_at');
    } catch (e) {
      return { status: 'error', error: e };
    }
    if (res.error) return !token && res.error.code === '23505' ? { status: 'conflict' } : { status: 'error', error: res.error, httpStatus: res.status };
    if (token && (!res.data || !res.data.length)) return { status: 'conflict' }; // no rows back = the version moved
    return { status: 'ok', token: (res.data && res.data[0] && res.data[0].updated_at) || row.updated_at };
  }

  // Fire-and-forget keepalive request for page unload. It cannot pull, merge or retry, so on a stale token the
  // database simply matches no rows and the next page load merges. Never merge-duplicates (that is the blind upsert).
  function unloadRequest(supabaseUrl, key, data, token, nowMs) {
    var base = supabaseUrl + '/rest/v1/app_state';
    return {
      method: token ? 'PATCH' : 'POST',
      url: token ? base + '?key=eq.' + encodeURIComponent(key) + '&updated_at=eq.' + encodeURIComponent(token) : base,
      prefer: 'return=minimal',
      body: JSON.stringify({ key: key, data: data, updated_at: nextStamp(token, nowMs) }),
    };
  }

  var api = { nextStamp: nextStamp, casWrite: casWrite, unloadRequest: unloadRequest };
  if (typeof window !== 'undefined') window.HypeCasWrite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

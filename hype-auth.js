// Owner sign-in for hype-audio. Why this exists (2026-09-30, design:
// Claude Outputs/2026-09-30-hype-audio-p0-design.md): the `hype-audio` app_state row
// used to be readable AND writable with the public anon key. Writes were RLS-denied by
// the 2026-09-22 policy tightening (silently, until sync.js grew a 'blocked' state), and
// the row -- 740 clips with full transcripts of personal rants -- was still publicly
// readable. The owner's Supabase session now does both, so the anon policy can be dropped.
//
// Deliberately NON-blocking, unlike Row's gate: playing the library must keep working with
// no signal in a gym, so the UI never waits on this. Only cloud sync needs a session; when
// there isn't one, sync.js shows a tappable "Sign in to sync".
//
// ONE shared client (getClient) is used by both this file and sync.js: several GoTrue
// instances on one page are documented as undefined behaviour under token refresh (the
// same finding Row's decisions.js fixed 2026-09-15, M6). The session is persisted by
// supabase-js in localStorage under sb-<project>-auth-token, which sync.js does not
// collect (it only syncs `hype_audio` and `hype_audio_events`).
(function () {
  'use strict';
  const cfg = window.SUPABASE_CONFIG || {};
  // Matches coaching_is_owner() server-side. The client check is defense in depth (RLS is
  // the real boundary) but "signed in" must mean "signed in as the owner", not "as anyone".
  const OWNER_EMAIL = 'carl.meyer.business@gmail.com';

  function isOwner(session) {
    return !!(session && session.user && session.user.email === OWNER_EMAIL);
  }

  // A hung getSession() (token refresh on a bad connection) must not hang callers.
  // Resolves to `fallback` on timeout OR rejection (a transport failure), like Row's helper.
  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then(
        function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function () { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } }
      );
    });
  }

  var _supa = null;
  var _session = null;       // the current OWNER session, or null
  var _listeners = [];
  var _watching = false;

  function getClient() {
    if (!window.supabase) return null;
    if (!_supa) _supa = window.supabase.createClient(cfg.URL, cfg.KEY);
    if (!_watching) {
      _watching = true;
      _supa.auth.onAuthStateChange(function (_evt, session) {
        _session = isOwner(session) ? session : null;
        notify();
      });
    }
    return _supa;
  }

  function notify() {
    _listeners.slice().forEach(function (cb) { try { cb(_session); } catch (e) {} });
  }

  // Resolves 'owner' | 'signedout' | 'unknown'. 'unknown' = could not reach the auth server
  // in time (offline / weak signal): the caller should treat it as offline, not as
  // "needs to sign in", so a gym with no signal doesn't nag for a password.
  async function status() {
    var supa = getClient();
    if (!supa) return 'unknown';
    var got = await withTimeout(supa.auth.getSession(), 6000, null);
    if (got === null) return 'unknown';
    var s = got && got.data && got.data.session;
    if (isOwner(s)) { _session = s; return 'owner'; }
    _session = null;
    return 'signedout';
  }

  async function signIn(email, password) {
    var supa = getClient();
    if (!supa) throw new Error('Supabase SDK not loaded');
    var res = await supa.auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw new Error(res.error.message);
    if (!isOwner(res.data.session)) {
      await supa.auth.signOut();
      throw new Error('That account is not the owner account.');
    }
    _session = res.data.session;
    notify();
    return _session;
  }

  async function signOut() {
    var supa = getClient();
    if (supa) await supa.auth.signOut();
    _session = null;
    notify();
  }

  // Sync (not async) on purpose: flushOnUnload runs while the page is being torn down and
  // cannot await anything. Kept current by onAuthStateChange above.
  function accessToken() { return _session ? _session.access_token : null; }

  function onChange(cb) { _listeners.push(cb); }

  function showLogin() {
    return new Promise(function (resolve) {
      if (document.getElementById('hype-auth-overlay')) return resolve(null);
      var overlay = document.createElement('div');
      overlay.id = 'hype-auth-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Sign in to sync');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(8,8,8,0.94);font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
      overlay.innerHTML =
        '<form id="ha-form" style="width:100%;max-width:340px;padding:32px 28px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);background:#111;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;margin:0 16px;">' +
          '<div style="color:#FAFAFA;font-size:17px;font-weight:700;">Hype Audio &mdash; sign in to sync</div>' +
          '<div style="color:rgba(250,250,250,0.6);font-size:12px;">Playback works without this. Signing in lets your library sync to the cloud.</div>' +
          '<input id="ha-email" type="email" placeholder="Email" autocomplete="username" style="padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);background:#0A0A0B;color:#FAFAFA;font-size:14px;">' +
          '<input id="ha-pass" type="password" placeholder="Password" autocomplete="current-password" style="padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.15);background:#0A0A0B;color:#FAFAFA;font-size:14px;">' +
          '<div id="ha-error" style="color:#FF6B6B;font-size:12px;display:none;"></div>' +
          '<button type="submit" style="padding:12px;border-radius:12px;border:0;background:#FAFAFA;color:#0A0A0B;font-size:14px;font-weight:700;cursor:pointer;">Sign in</button>' +
          '<button type="button" id="ha-cancel" style="padding:8px;border:0;background:none;color:rgba(250,250,250,0.5);font-size:12px;cursor:pointer;">Not now (stay local)</button>' +
        '</form>';
      document.body.appendChild(overlay);
      // Keyboard/screen-reader users land in the dialog, and Escape means "not now".
      overlay.querySelector('#ha-email').focus();
      overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') { overlay.remove(); resolve(null); } });
      var form = overlay.querySelector('#ha-form');
      var err = overlay.querySelector('#ha-error');
      overlay.querySelector('#ha-cancel').addEventListener('click', function () { overlay.remove(); resolve(null); });
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        err.style.display = 'none';
        try {
          var s = await signIn(overlay.querySelector('#ha-email').value.trim(), overlay.querySelector('#ha-pass').value);
          overlay.remove();
          resolve(s);
        } catch (ex) {
          err.textContent = ex.message || 'Sign-in failed.';
          err.style.display = 'block';
        }
      });
    });
  }

  window.HypeAuth = { getClient: getClient, status: status, signIn: signIn, signOut: signOut, accessToken: accessToken, onChange: onChange, showLogin: showLogin, isOwner: isOwner };
})();

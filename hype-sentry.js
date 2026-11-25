// Client-side error reporting; must stay the FIRST script after the vendored SDK (sentry.selfcheck.js). Copy of Vessel's
// vessel-sentry.js: the SDK ships from this origin and events go to /api/sentry-tunnel, because Brave Shields blocks Sentry's CDN and
// ingest hosts. One Sentry project is shared with Row and Vessel; every event carries tag app=hype-audio. The DSN's public key is
// not a secret (same class as the Supabase anon key).
//
// HypeSentry.report(err, where): how sync and upload code reports a failure it HANDLES. No SDK, offline or a throwing SDK = no-op.
window.HypeSentry = {
  report: function (err, where) {
    try {
      if (!window.Sentry || typeof window.Sentry.captureException !== 'function') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      var e = err instanceof Error ? err : new Error(String(err && err.message ? err.message : err));
      window.Sentry.captureException(e, { tags: { where: String(where || 'unknown') } });
    } catch (_) { /* reporting must never break the caller */ }
  },
};

(function () {
  if (!window.Sentry || typeof window.Sentry.init !== 'function') return;
  window.Sentry.init({
    dsn: 'https://fce96c17d8952cb2458d55c4ab24fd51@o4511889585733632.ingest.us.sentry.io/4512101673271296',
    tunnel: '/api/sentry-tunnel',
    environment: /^hype-audio-app(-git-master)?(-carl-meyer-s-projects)?\.vercel\.app$/.test(location.hostname) ? 'production' : 'preview',
    initialScope: { tags: { app: 'hype-audio' } },
    // Errors only. No tracing/replay.
    sampleRate: 1,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
})();

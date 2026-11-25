// Pure logic for /api/sentry-tunnel -- no I/O, so it's unit-testable.
//
// A Sentry envelope is newline-delimited: the first line is a JSON header
// carrying the DSN the SDK was initialised with. The tunnel forwards the
// body verbatim to Sentry's ingest endpoint for THAT project -- but only
// if the DSN is ours, otherwise this public POST route would be an open
// relay anyone could use to spam other Sentry projects through this domain.

export const ALLOWED_HOST = 'o4511889585733632.ingest.us.sentry.io';
export const ALLOWED_PROJECT_ID = '4512101673271296';
export const MAX_BODY_BYTES = 512 * 1024; // errors-only events are a few KB; 512KB is generous

// Returns { ok: true, url } or { ok: false, status, error }.
export function planForward(rawBody, opts = {}) {
  const allowedHost = opts.allowedHost ?? ALLOWED_HOST;
  const allowedProjectId = opts.allowedProjectId ?? ALLOWED_PROJECT_ID;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;

  if (!rawBody || rawBody.length === 0) return { ok: false, status: 400, error: 'empty envelope' };
  if (rawBody.length > maxBytes) return { ok: false, status: 413, error: 'envelope too large' };

  const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const headerLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  let header;
  try { header = JSON.parse(headerLine); } catch { return { ok: false, status: 400, error: 'malformed envelope header' }; }
  if (!header || typeof header.dsn !== 'string') return { ok: false, status: 400, error: 'envelope header has no dsn' };

  let dsn;
  try { dsn = new URL(header.dsn); } catch { return { ok: false, status: 400, error: 'dsn is not a URL' }; }
  const projectId = dsn.pathname.replace(/^\/+/, '');
  if (dsn.hostname !== allowedHost || projectId !== allowedProjectId) {
    return { ok: false, status: 403, error: 'dsn is not this app\'s project' };
  }
  return { ok: true, url: `https://${allowedHost}/api/${projectId}/envelope/` };
}

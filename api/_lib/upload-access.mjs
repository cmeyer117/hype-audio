import { sameSecret } from './same-secret.mjs';
// Fixed-size, process-local damping. No caller-controlled identity map and no
// persistent/distributed guarantee across serverless instances or restarts.
export function createUploadGate({ maxAttempts = 60, windowMs = 60_000, now = Date.now } = {}) {
  let count = 0, resetAt = 0;
  return (given, expected) => {
    if (typeof expected !== 'string' || !expected) return 500;
    const time = now();
    if (time >= resetAt) { count = 0; resetAt = time + windowMs; }
    if (++count > maxAttempts) return 429;
    return sameSecret(given, expected) ? 200 : 401;
  };
}

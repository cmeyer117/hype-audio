// Constant-time comparison for the upload passphrase (Opus auth pass 2026-11-12, finding E). Hashing both sides
// first gives equal-length buffers, so neither the content nor the length of the secret leaks through timing.
// Underscore folder: Vercel does not deploy it as a function.
import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (s) => createHash('sha256').update(s).digest()

export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false
  return timingSafeEqual(digest(given), digest(expected))
}

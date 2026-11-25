// POST /api/sentry-tunnel: hype-sentry.js sends Sentry envelopes here, on this origin, and this forwards them (Brave Shields blocks
// *.ingest.sentry.io). Public by design (errors happen before sign-in), so it only relays envelopes for this project: planForward().
// Raw body: envelopes are newline-delimited text, so Vercel's parser must stay out of the way.
import { planForward, MAX_BODY_BYTES } from './_lib/sentry-tunnel-logic.mjs';

export const config = { api: { bodyParser: false } };

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) return null; // stop reading early
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rawBody = await readRawBody(req, MAX_BODY_BYTES);
  if (rawBody === null) return res.status(413).json({ error: 'envelope too large' });
  const plan = planForward(rawBody);
  if (!plan.ok) return res.status(plan.status).json({ error: plan.error });
  try {
    // Bounded: a stalled ingest answers 502 instead of holding the function open.
    const upstream = await fetch(plan.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: rawBody,
      signal: AbortSignal.timeout(8000),
    });
    // Mirror the status so the SDK's backoff sees the truth (429 on quota).
    return res.status(upstream.status).end();
  } catch (e) {
    return res.status(502).json({ error: 'upstream unreachable' });
  }
}

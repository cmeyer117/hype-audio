// GET /api/health: which commit is live, for post-deploy smoke checks. No auth, no database, no secrets.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown' });
}

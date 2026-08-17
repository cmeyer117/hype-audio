// Vercel serverless function -- the only path allowed to write into
// content_ideas from hype-audio-app. RLS on content_ideas only grants ALL
// to `authenticated` under coaching_is_owner() (confirmed live via
// pg_policies) -- hype-audio-app has no login system, so anon can't write
// here at all. Same trust model as /api/upload-clip.mjs: service-role key
// server-side, gated by the same shared passphrase (one user, one secret,
// reused rather than minting a second one for the same trust boundary).
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co'
const ALLOWED_PILLARS = ['mindset', 'training', 'life', 'faith', 'diet']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.HYPE_AUDIO_UPLOAD_SECRET
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured: HYPE_AUDIO_UPLOAD_SECRET not set' })
    return
  }
  if (req.headers['x-upload-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { title, hook, pillar, body, sourceClipId, sourceStorageUrl } = req.body || {}
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Missing or invalid title' })
    return
  }
  if (typeof pillar !== 'string' || !ALLOWED_PILLARS.includes(pillar)) {
    res.status(400).json({ error: 'Missing or invalid pillar' })
    return
  }

  const notes = (typeof sourceClipId === 'string' && sourceClipId)
    ? `Source: hype-audio clip ${sourceClipId} (${typeof sourceStorageUrl === 'string' ? sourceStorageUrl : 'no storage_url'})`
    : null

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase
    .from('content_ideas')
    .insert({
      title: title.trim(),
      hook: typeof hook === 'string' && hook.trim() ? hook.trim() : null,
      pillar,
      body: typeof body === 'string' && body.trim() ? body.trim() : null,
      notes,
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    console.error('[create-content-idea] insert failed:', error?.message)
    res.status(502).json({ error: 'Could not create content idea' })
    return
  }

  res.status(200).json({ id: data.id })
}

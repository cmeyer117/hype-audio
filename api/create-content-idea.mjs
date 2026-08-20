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

// Looks up an existing row by source_hype_clip_id. Shared by the pre-insert
// dedup check and the post-conflict recovery path below.
async function findBySourceClipId(supabase, sourceClipId) {
  const { data } = await supabase
    .from('content_ideas')
    .select('id')
    .eq('source_hype_clip_id', sourceClipId)
    .maybeSingle()
  return data?.id || null
}

// Pure request handler, injectable with a fake supabase client for tests
// (see create-content-idea.selfcheck.js) -- same split as the content repo's
// api/ingest-content-ideas.js. `body` is the parsed JSON request body.
export async function handleCreateContentIdeaRequest(body, supabase) {
  const { title, hook, pillar, body: contentBody, sourceClipId, sourceStorageUrl } = body || {}
  if (typeof title !== 'string' || !title.trim()) {
    return { status: 400, body: { error: 'Missing or invalid title' } }
  }
  if (typeof pillar !== 'string' || !ALLOWED_PILLARS.includes(pillar)) {
    return { status: 400, body: { error: 'Missing or invalid pillar' } }
  }

  const hasClipId = typeof sourceClipId === 'string' && !!sourceClipId
  const notes = hasClipId
    ? `Source: hype-audio clip ${sourceClipId} (${typeof sourceStorageUrl === 'string' ? sourceStorageUrl : 'no storage_url'})`
    : null

  // Idempotency: a clip already sent (server succeeded, client's local flag
  // never landed) must not create a second row on retry -- reuse the id
  // that's already there instead of inserting again.
  if (hasClipId) {
    const existingId = await findBySourceClipId(supabase, sourceClipId)
    if (existingId) return { status: 200, body: { id: existingId } }
  }

  const { data, error } = await supabase
    .from('content_ideas')
    .insert({
      title: title.trim(),
      hook: typeof hook === 'string' && hook.trim() ? hook.trim() : null,
      pillar,
      body: typeof contentBody === 'string' && contentBody.trim() ? contentBody.trim() : null,
      notes,
      source_hype_clip_id: hasClipId ? sourceClipId : null,
    })
    .select('id')
    .single()

  if (error) {
    // Race: another request for the same clip inserted between our dedup
    // check and this insert. The partial unique index on
    // source_hype_clip_id rejects it (code 23505) -- recover the winning
    // row's id instead of surfacing an error.
    if (error.code === '23505' && hasClipId) {
      const existingId = await findBySourceClipId(supabase, sourceClipId)
      if (existingId) return { status: 200, body: { id: existingId } }
    }
    console.error('[create-content-idea] insert failed:', error.message)
    return { status: 502, body: { error: 'Could not create content idea' } }
  }
  if (!data?.id) {
    return { status: 502, body: { error: 'Could not create content idea' } }
  }

  return { status: 200, body: { id: data.id } }
}

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

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { status, body } = await handleCreateContentIdeaRequest(req.body, supabase)
  res.status(status).json(body)
}

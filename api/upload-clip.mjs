// Vercel serverless function -- the only path allowed to authorize writes
// into the `hype-audio` Storage bucket. Anonymous client-side uploads are
// blocked by RLS (found 2026-08-17 via a live Codex audit probe), and
// opening anonymous Storage inserts would make the bucket writable by
// anyone who finds the endpoint -- so authorization stays server-side with
// the service-role key, gated by a shared secret. This app has exactly one
// user and no login system, so a passphrase header is proportionate; a full
// Supabase Auth flow would be over-engineering for a single-user library.
//
// 2026-08-16: this endpoint no longer relays the file itself. The old
// base64-through-the-function flow silently broke every upload over ~3.3MB
// (Vercel's 4.5MB request-body cap, plus base64's +33%) while advertising
// an 8MB limit. Now it just validates the passphrase and returns a one-time
// signed upload URL; the client PUTs the raw file straight to Storage.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co'
const BUCKET = 'hype-audio'

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

  const { filename, contentType } = req.body || {}
  if (typeof filename !== 'string' || !filename || filename.length > 200) {
    res.status(400).json({ error: 'Missing or invalid filename' })
    return
  }
  if (typeof contentType !== 'string' || !contentType.startsWith('audio/')) {
    res.status(400).json({ error: 'Missing or invalid contentType' })
    return
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectName = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${safeName}`

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectName)

  if (error || !data?.signedUrl) {
    console.error('[upload-clip] createSignedUploadUrl failed:', error?.message)
    res.status(502).json({ error: 'Could not authorize upload' })
    return
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectName)
  if (!pub?.publicUrl) {
    res.status(502).json({ error: 'Could not resolve public URL' })
    return
  }

  res.status(200).json({ uploadUrl: data.signedUrl, publicUrl: pub.publicUrl })
}

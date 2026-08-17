// Vercel serverless function -- the only path allowed to write into the
// `hype-audio` Storage bucket. Anonymous client-side uploads were blocked by
// RLS the whole time (found 2026-08-17 via a live Codex audit probe: a real
// upload attempt returned a 403 "new row violates row-level security
// policy" -- both the regular upload form and record-your-own's Save have
// never actually persisted a clip). Opening anonymous Storage inserts would
// make the bucket writable by anyone who finds the endpoint, so this stays
// server-side with the service-role key, gated by a shared secret -- this
// app has exactly one user and no existing login system, so a passphrase
// header (same class as Jarvis's pre-2026-08-05 gate) is proportionate; a
// full Supabase Auth login flow would be over-engineering for a single-user
// public clip library.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vikpcejlyxieguorwysf.supabase.co'
const BUCKET = 'hype-audio'
// Rejected well before Vercel's own body-size limit so the client gets a
// clear reason instead of a generic 413.
const MAX_FILE_BYTES = 8 * 1024 * 1024

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

  const { filename, contentType, fileBase64 } = req.body || {}
  if (typeof filename !== 'string' || !filename || filename.length > 200) {
    res.status(400).json({ error: 'Missing or invalid filename' })
    return
  }
  if (typeof contentType !== 'string' || !contentType.startsWith('audio/')) {
    res.status(400).json({ error: 'Missing or invalid contentType' })
    return
  }
  if (typeof fileBase64 !== 'string' || !fileBase64) {
    res.status(400).json({ error: 'Missing file data' })
    return
  }

  let buffer
  try {
    buffer = Buffer.from(fileBase64, 'base64')
  } catch {
    res.status(400).json({ error: 'Invalid file encoding' })
    return
  }
  if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
    res.status(400).json({ error: `File must be under ${MAX_FILE_BYTES / 1024 / 1024}MB` })
    return
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectName = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${safeName}`

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectName, buffer, { contentType, upsert: false })

  if (error) {
    console.error('[upload-clip] Storage upload failed:', error.message)
    res.status(502).json({ error: 'Storage upload failed' })
    return
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectName)
  if (!data?.publicUrl) {
    res.status(502).json({ error: 'Upload succeeded but could not resolve public URL' })
    return
  }

  res.status(200).json({ url: data.publicUrl })
}

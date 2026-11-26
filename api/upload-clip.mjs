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
import { prepareUpload, completeUpload, recoverUploads } from './_lib/upload-intents.mjs'
import { createUploadGate } from './_lib/upload-access.mjs'
const uploadGate = createUploadGate()

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
  const access = uploadGate(req.headers['x-upload-secret'], secret)
  if (access !== 200) {
    if (access === 429) res.setHeader('Retry-After', '60')
    res.status(access).json({ error: access === 429 ? 'Too many requests' : 'Unauthorized' })
    return
  }

  const { filename, contentType, metadata, action, uploadId } = req.body || {}
  if (action === 'complete' || action === 'recover') {
    if (action === 'complete' && (typeof uploadId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(uploadId))) {
      return res.status(400).json({ error: 'Invalid upload identity' })
    }
    try {
      const db = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      return res.status(200).json(action === 'recover' ? await recoverUploads(db) : await completeUpload(db, uploadId))
    } catch {
      return res.status(503).json({ error: 'Audio metadata is awaiting confirmation. Retry unfinished uploads.' })
    }
  }
  let clip
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || typeof metadata.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(metadata.id)
      || typeof metadata.title !== 'string' || !metadata.title.trim() || metadata.title.length > 200) {
      return res.status(400).json({ error: 'Invalid clip metadata' })
    }
    clip = { id: metadata.id }
    for (const field of ['title', 'mentality', 'pillar', 'moment', 'source_type', 'use_case', 'delivery_role']) {
      const value = metadata[field]
      if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 300)) return res.status(400).json({ error: 'Invalid clip metadata' })
      if (value !== undefined) clip[field] = value
    }
  }
  if (typeof filename !== 'string' || !filename || filename.length > 200) {
    res.status(400).json({ error: 'Missing or invalid filename' })
    return
  }
  if (typeof contentType !== 'string' || !contentType.startsWith('audio/')) {
    res.status(400).json({ error: 'Missing or invalid contentType' })
    return
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectName = clip ? `clip_${clip.id}_${safeName}` : `clip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${safeName}`

  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectName)
  if (!pub?.publicUrl) return res.status(502).json({ error: 'Could not resolve public URL' })
  if (clip) {
    try { await prepareUpload(supabase, clip.id, objectName, clip, pub.publicUrl) }
    catch (error) {
      if (error?.code === 'UPLOAD_IDENTITY_CONFLICT') return res.status(409).json({ error: 'Recover the original unfinished upload before changing its details.' })
      return res.status(503).json({ error: 'Could not save upload recovery metadata' })
    }
  }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectName)

  if (error || !data?.signedUrl) {
    console.error('[upload-clip] createSignedUploadUrl failed:', error?.message)
    res.status(502).json({ error: 'Could not authorize upload' })
    return
  }

  res.status(200).json({ uploadUrl: data.signedUrl, publicUrl: pub.publicUrl })
}

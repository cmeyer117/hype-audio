const intentKey = id => 'hype:upload:' + id
const now = () => new Date().toISOString()

export async function prepareUpload(db, id, objectName, metadata, publicUrl) {
  const clip = { ...metadata, id, storage_url: publicUrl, created_at: now(), updated_at: Date.now(), play_count: 0 }
  const data = { phase: 'pending', objectName, clip }
  const { error } = await db.from('app_state').insert({ key: intentKey(id), data, updated_at: now() })
  if (error && error.code !== '23505') throw new Error('Upload metadata intent could not be saved')
  if (error) {
    const existing = await db.from('app_state').select('data').eq('key', intentKey(id)).maybeSingle()
    if (existing.error) throw new Error('Upload metadata intent could not be checked')
    const original = existing.data?.data
    if (original?.objectName !== objectName || !original?.clip
      || Object.keys(metadata).some(field => original.clip[field] !== metadata[field])) {
      const conflict = new Error('Recover the original unfinished upload before changing its details')
      conflict.code = 'UPLOAD_IDENTITY_CONFLICT'
      throw conflict
    }
  }
}

export async function completeUpload(db, id) {
  const intent = await db.from('app_state').select('data,updated_at').eq('key', intentKey(id)).maybeSingle()
  if (intent.error || !intent.data?.data?.clip) throw new Error('Upload metadata intent is unavailable')
  const saved = intent.data.data
  if (!/^[a-zA-Z0-9_.-]{1,350}$/.test(saved.objectName)) throw new Error('Invalid upload object identity')
  const objects = await db.storage.from('hype-audio').list('', { search: saved.objectName, limit: 100 })
  if (objects.error) throw new Error('Uploaded audio could not be checked')
  if (!objects.data?.some(object => object.name === saved.objectName && Number(object.metadata?.size) > 0)) return { confirmed: false }
  let clip
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await db.from('app_state').select('key,data,updated_at').eq('key', 'hype-audio').maybeSingle()
    if (remote.error) throw new Error('Library metadata could not be read')
    const data = remote.data?.data ?? {}
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.hype_audio !== undefined && !Array.isArray(data.hype_audio))) throw new Error('Library metadata is malformed')
    const clips = data.hype_audio ?? []
    const existing = clips.find(item => item.id === id)
    if (clips.some(item => item.id === id && item.deleted)) throw new Error('This clip was deleted while its upload was pending')
    if (existing) {
      if (existing.storage_url !== saved.clip.storage_url) throw new Error('Clip identity already belongs to another upload')
      clip = existing
      break
    }
    const revision = new Date(Math.max(Date.now(), (Date.parse(remote.data?.updated_at) || 0) + 1)).toISOString()
    const body = { key: 'hype-audio', data: { ...data, hype_audio: [...clips, saved.clip] }, updated_at: revision }
    let write
    if (remote.data) {
      let query = db.from('app_state').update(body).eq('key', 'hype-audio')
      query = remote.data.updated_at == null ? query.is('updated_at', null) : query.eq('updated_at', remote.data.updated_at)
      write = await query.select('key,data,updated_at')
    } else write = await db.from('app_state').insert(body).select('key,data,updated_at')
    if (write.error && write.error.code !== '23505') throw new Error('Library metadata was not saved')
    if (write.data?.length === 1) {
      clip = write.data[0].data?.hype_audio?.find(item => item.id === id && item.storage_url === saved.clip.storage_url && !item.deleted)
      if (!clip) throw new Error('Library metadata receipt was incomplete')
      break
    }
  }
  if (!clip) throw new Error('Library metadata is awaiting a conflict retry')
  // The library receipt is the completion condition. A lost intent-marker write
  // leaves recovery work that safely finds the same already-published clip.
  await db.from('app_state').update({ data: { ...saved, phase: 'confirmed' }, updated_at: now() })
    .eq('key', intentKey(id)).eq('updated_at', intent.data.updated_at)
  return { confirmed: true, clip }
}

export async function recoverUploads(db) {
  const { data, error } = await db.from('app_state').select('key,data').like('key', 'hype:upload:%')
    .eq('data->>phase', 'pending').order('updated_at').limit(11)
  if (error) throw new Error('Unfinished uploads could not be read')
  const clips = []
  let pending = 0
  for (const row of (data ?? []).slice(0, 10)) {
    try {
      const result = await completeUpload(db, row.key.slice('hype:upload:'.length))
      if (result.confirmed) clips.push(result.clip)
      else pending++
    } catch { pending++ }
    // Rotate checked items so a missing file cannot starve later uploads.
    await db.from('app_state').update({ updated_at: now() }).eq('key', row.key).eq('data->>phase', 'pending')
  }
  return { clips, pending, hasMore: (data?.length ?? 0) > 10 }
}

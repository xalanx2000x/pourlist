import 'server-only'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * Derives the Supabase Storage path from a public URL.
 */
export function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

/**
 * Map a MIME type to a storage-safe extension. Used for both the filename
 * suffix and the upload contentType (which is set from the same `file.type`).
 */
export function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic'
  return 'bin' // honest unknown — better than lying about the type
}

/**
 * Upload a list of photos to venue-photos storage. Each file's extension and
 * contentType are derived from file.type — no hardcoded image/jpeg.
 *
 * Returns the array of public URLs in upload order.
 */
export async function uploadPhotos(
  venueId: string,
  rawPhotos: (string | File)[]
): Promise<{ urls: string[]; failed: boolean }> {
  if (rawPhotos.length === 0) return { urls: [], failed: false }

  const timestamp = Date.now()
  const uploadedUrls: string[] = []
  for (let i = 0; i < rawPhotos.length; i++) {
    const raw = rawPhotos[i]
    const fileName = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.jpg`
    const filePath = `${venueId}/${timestamp}/${fileName}`

    let buffer: Buffer
    let ext = 'jpg'
    let contentType = 'image/jpeg'
    if (typeof raw === 'string') {
      // base64 data URL — pull mime from the prefix when present
      const m = raw.match(/^data:([^;]+);base64,/)
      if (m) {
        const mime = m[1]
        ext = mimeToExt(mime)
        contentType = mime
      }
      buffer = Buffer.from(raw.replace(/^data:[^;]+;base64,/, ''), 'base64')
    } else {
      const file = raw as File
      ext = mimeToExt(file.type || 'image/jpeg')
      contentType = file.type || 'image/jpeg'
      // Filename extension: rewrite the random suffix above to use real ext.
      const fileNameReal = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.${ext}`
      const filePathReal = `${venueId}/${timestamp}/${fileNameReal}`
      buffer = Buffer.from(await file.arrayBuffer())

      const { error: uploadError } = await supabaseServer.storage
        .from('venue-photos')
        .upload(filePathReal, buffer, { contentType, upsert: false })
      if (uploadError) {
        console.error('[seed] photo upload error:', uploadError)
        return { urls: uploadedUrls, failed: true }
      }
      const { data: urlData } = supabaseServer.storage.from('venue-photos').getPublicUrl(filePathReal)
      uploadedUrls.push(urlData.publicUrl)
      continue
    }

    const { error: uploadError } = await supabaseServer.storage
      .from('venue-photos')
      .upload(filePath, buffer, { contentType, upsert: false })
    if (uploadError) {
      console.error('[seed] photo upload error:', uploadError)
      return { urls: uploadedUrls, failed: true }
    }
    const { data: urlData } = supabaseServer.storage.from('venue-photos').getPublicUrl(filePath)
    uploadedUrls.push(urlData.publicUrl)
  }
  return { urls: uploadedUrls, failed: false }
}

/**
 * Persist a photo set + enforce max-4 retention policy.
 * Mirrors submit-venue/commit-menu exactly.
 */
export async function commitPhotoSet(venueId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return
  await supabaseServer.from('photo_sets').insert({ venue_id: venueId, photo_urls: urls })

  const { data: sets } = await supabaseServer
    .from('photo_sets')
    .select('id, created_at, photo_urls')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })

  if (sets && sets.length > 4) {
    const toDelete = sets.slice(4)
    const storagePaths = toDelete
      .flatMap(s => s.photo_urls as string[])
      .map(url => storagePathFromUrl(url))
      .filter(p => p.length > 0)
    await supabaseServer.from('photo_sets').delete().in('id', toDelete.map(s => s.id))
    if (storagePaths.length > 0) {
      await supabaseServer.storage.from('venue-photos').remove([...new Set(storagePaths)])
    }
  }
}

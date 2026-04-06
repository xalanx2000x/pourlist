import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/upload-photo
 * Body: FormData with fields:
 *   - photo: File
 *   - venueId?: string
 *   - deviceHash?: string
 *   - lat?: string
 *   - lng?: string
 *   - fingerprint?: string (client-computed file fingerprint)
 * Uploads photo to Supabase Storage, returns the public URL.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const photo = formData.get('photo') as File | null
    const venueId = formData.get('venueId') as string | null
    const deviceHash = formData.get('deviceHash') as string | null
    const lat = formData.get('lat') as string | null
    const lng = formData.get('lng') as string | null
    const fingerprint = formData.get('fingerprint') as string | null

    if (!photo) {
      return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
    }

    const fileExt = photo.name.split('.').pop() || 'jpg'
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
    const filePath = `venue-photos/${fileName}`

    // Convert File to Buffer
    const arrayBuffer = await photo.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('venue-photos')
      .upload(filePath, buffer, {
        contentType: photo.type,
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('venue-photos')
      .getPublicUrl(filePath)

    const photoUrl = urlData.publicUrl

    // Insert photo record (hash stored separately when we add pHash support)
    if (venueId) {
      const { error: insertError } = await supabase.from('photos').insert({
        venue_id: venueId,
        url: photoUrl,
        uploader_device_hash: deviceHash || 'anonymous',
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null,
        status: 'pending'
      })

      if (insertError) {
        console.error('Photo record insert error:', insertError)
      }
    }

    return NextResponse.json({
      url: photoUrl,
      fingerprint: fingerprint || `${photo.size}-${photo.name.toLowerCase()}-${photo.lastModified}`
    })
  } catch (err: unknown) {
    console.error('Upload error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

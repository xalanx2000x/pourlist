import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Admin client bypasses RLS for calling the cycle_old_photos RPC
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * Derives the storage file path from a Supabase Storage public URL.
 * E.g. "https://xxx.supabase.co/storage/v1/object/public/venue-photos/abc.jpg"
 *  → "venue-photos/abc.jpg"
 */
function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

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

    // 20MB limit
    if (photo.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 20MB.' }, { status: 400 })
    }

    // MIME type allowlist
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/heif-compressed']
    if (!ALLOWED_TYPES.includes(photo.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    // Server-side rate limit check (fail-open — doesn't block user on error)
    if (deviceHash) {
      try {
        const rateLimitRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL}/api/rate-limit-check`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'upload-photo', deviceHash })
          }
        )
        if (rateLimitRes.ok) {
          const { allowed } = await rateLimitRes.json() as { allowed: boolean }
          if (!allowed) {
            return NextResponse.json(
              { error: 'Too many requests. Please wait a moment before trying again.' },
              { status: 429 }
            )
          }
        }
      } catch {
        // Fail open — don't block upload if rate-limit service is unreachable
      }
    }

    // Always store as JPEG — extension is always .jpg regardless of device.
    // The original filename's extension is unreliable (iPhone HEIC files named
    // .jpg, Android WebP named .png, etc.). JPEG is the universal safe format
    // for menu photos.
    const fileName = `${randomUUID()}.jpg`
    const filePath = `venue-photos/${fileName}`

    // Convert File to Buffer
    const arrayBuffer = await photo.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage — always as image/jpeg
    const { error: uploadError } = await supabase.storage
      .from('venue-photos')
      .upload(filePath, buffer, {
        contentType: 'image/jpeg',
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('venue-photos')
      .getPublicUrl(filePath)

    const photoUrl = urlData.publicUrl

    // Insert photo record (hash stored separately when we add pHash support)
    // lat/lng used for verification only — NOT stored
    // location_verified will be set by /api/submit-menu after geo-check
    if (venueId) {
      const { error: insertError } = await supabase.from('photos').insert({
        venue_id: venueId,
        url: photoUrl,
        uploader_device_hash: deviceHash || 'anonymous',
        status: 'pending',
        // lat/lng intentionally omitted — coordinates not stored
      })

      if (insertError) {
        console.error('Photo record insert error:', insertError)
      }

      // ── Per-venue photo retention (keep 3 most recent) ──────────────────────
      // After inserting, call cycle_old_photos to:
      //   1. Delete DB records for photos beyond the 3 most recent for this venue
      //   2. Return the storage paths of deleted photos so we can purge the files
      // Never deletes photos with status = 'approved'.
      if (!insertError) {
        try {
          const { data: deletedRows, error: cycleError } = await supabaseAdmin
            .rpc('cycle_old_photos', { p_venue_id: venueId })

          if (cycleError) {
            console.error('cycle_old_photos error:', cycleError)
          } else if (deletedRows && deletedRows.length > 0) {
            // Collect unique storage paths and delete files from Supabase Storage
            const storagePaths = deletedRows
              .map((row: { storage_path?: string; deleted_id?: string }) =>
                row.storage_path ? storagePathFromUrl(row.storage_path) : ''
              )
              .filter((p: string) => p.length > 0)

            const uniquePaths = [...new Set(storagePaths)] as string[]
            if (uniquePaths.length > 0) {
              const { error: storageDeleteError } = await supabaseAdmin.storage
                .from('venue-photos')
                .remove(uniquePaths)

              if (storageDeleteError) {
                console.error('Storage file deletion error:', storageDeleteError)
              } else {
                console.log(
                  `Photo retention: deleted ${uniquePaths.length} old file(s) from storage for venue ${venueId}`
                )
              }
            }
          }
        } catch (err) {
          // Fail silently — photo upload succeeded, retention cleanup is non-critical
          console.error('Photo retention cycle error:', err)
        }
      }
    }

    return NextResponse.json({
      url: photoUrl,
      fingerprint: fingerprint || `${photo.size}-${photo.name.toLowerCase()}-${photo.lastModified}`,
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null
    })
  } catch (err: unknown) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

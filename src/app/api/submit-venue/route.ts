import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Derives the Supabase Storage path from a public URL.
 */
function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

/**
 * Normalize venue name for comparison: strip leading "The", lowercase, trim.
 */
function normName(n: string) {
  return n.replace(/^the\s+/i, '').toLowerCase().trim()
}

/**
 * Haversine distance in meters between two coordinates.
 */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * POST /api/submit-venue
 *
 * Single-step new venue creation: dedup check, insert venue, upload photos.
 * Replaces the old create-venue → commit-menu two-step flow for new venues.
 *
 * Body (multipart/form-data):
 *   venueName: string (required)
 *   exifLat: number (authoritative venue GPS from first photo's EXIF)
 *   exifLng: number
 *   phoneLat?: number (phone's current GPS — used for fraud signal logging only)
 *   phoneLng?: number
 *   deviceHash: string
 *
 *   // Structured HH windows (up to 3)
 *   hh_summary?: string
 *   hh_type, hh_days, hh_start, hh_end (window 1)
 *   hh_type_2, hh_days_2, hh_start_2, hh_end_2 (window 2)
 *   hh_type_3, hh_days_3, hh_start_3, hh_end_3 (window 3)
 *
 *   photos?: File[]
 *
 * Returns:
 *   { success: true, venueId } — normal success
 *   { success: false, reason: 'duplicate', existingVenue } — name dedup match found
 *   { success: false, reason: 'photo_upload_failed' } — photo upload failed, venue rolled back
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const body = Object.fromEntries(formData.entries())

    const {
      venueName,
      exifLat,
      exifLng,
      phoneLat,
      phoneLng,
      deviceHash,
      hhSummary,
      hh_type,
      hh_days,
      hh_exclude_days,
      hh_start,
      hh_end,
      hh_type_2,
      hh_days_2,
      hh_exclude_days_2,
      hh_start_2,
      hh_end_2,
      hh_type_3,
      hh_days_3,
      hh_exclude_days_3,
      hh_start_3,
      hh_end_3
    } = body as {
      venueName?: string
      exifLat?: string | number
      exifLng?: string | number
      phoneLat?: string | number
      phoneLng?: string | number
      deviceHash?: string
      hhSummary?: string
      hh_type?: string
      hh_days?: string
      hh_exclude_days?: string
      hh_start?: string
      hh_end?: string
      hh_type_2?: string
      hh_days_2?: string
      hh_exclude_days_2?: string
      hh_start_2?: string
      hh_end_2?: string
      hh_type_3?: string
      hh_days_3?: string
      hh_exclude_days_3?: string
      hh_start_3?: string
      hh_end_3?: string
    }

    // ── Validation ─────────────────────────────────────────────────────────
    if (!venueName?.trim()) {
      return NextResponse.json({ error: 'venueName is required' }, { status: 400 })
    }
    if (!deviceHash) {
      return NextResponse.json({ error: 'deviceHash is required' }, { status: 400 })
    }
    if (exifLat == null || exifLng == null) {
      return NextResponse.json({ error: 'exifLat and exifLng are required' }, { status: 400 })
    }

    const venueLat = typeof exifLat === 'string' ? parseFloat(exifLat) : exifLat
    const venueLng = typeof exifLng === 'string' ? parseFloat(exifLng) : exifLng

    if (isNaN(venueLat) || isNaN(venueLng)) {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 })
    }

    // ── Dedup: find nearby venue with same/similar name ─────────────────────
    const dedupRadiusM = 50
    const latDelta = dedupRadiusM / 111320
    const cosLat = Math.cos((venueLat * Math.PI) / 180)
    const lngDelta = dedupRadiusM / (111320 * (cosLat < 0.01 ? 0.01 : cosLat))

    const { data: nearbyVenues } = await supabase
      .from('venues')
      .select('id, name, lat, lng, status')
      .not('status', 'eq', 'closed')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .gte('lat', venueLat - latDelta)
      .lte('lat', venueLat + latDelta)
      .gte('lng', venueLng - lngDelta)
      .lte('lng', venueLng + lngDelta)

    if (nearbyVenues && nearbyVenues.length > 0) {
      const normalizedNewName = normName(venueName.trim())
      const match = nearbyVenues.find(v => {
        if (haversineM(venueLat, venueLng, v.lat!, v.lng!) > dedupRadiusM) return false
        return normName(v.name) === normalizedNewName
      })

      if (match) {
        console.log(`[submit-venue] dedup: found existing venue "${match.name}" (${match.id}) for "${venueName}"`)
        return NextResponse.json({
          success: false,
          reason: 'duplicate',
          existingVenue: { id: match.id, name: match.name }
        })
      }
    }

    // ── Insert new venue ───────────────────────────────────────────────────
    const { data: newVenue, error: venueError } = await supabase
      .from('venues')
      .insert({
        name: venueName.trim(),
        lat: venueLat,
        lng: venueLng,
        status: 'unverified',
        contributor_trust: 'new',
        menu_text: null,
        latest_menu_image_url: null,
        hh_summary: hhSummary?.trim() || null,
        hh_type: hh_type || null,
        hh_days: hh_days || null,
        hh_exclude_days: hh_exclude_days || null,
        hh_start: hh_start ? parseInt(hh_start) : null,
        hh_end: hh_end ? parseInt(hh_end) : null,
        hh_type_2: hh_type_2 || null,
        hh_days_2: hh_days_2 || null,
        hh_exclude_days_2: hh_exclude_days_2 || null,
        hh_start_2: hh_start_2 ? parseInt(hh_start_2) : null,
        hh_end_2: hh_end_2 ? parseInt(hh_end_2) : null,
        hh_type_3: hh_type_3 || null,
        hh_days_3: hh_days_3 || null,
        hh_exclude_days_3: hh_exclude_days_3 || null,
        hh_start_3: hh_start_3 ? parseInt(hh_start_3) : null,
        hh_end_3: hh_end_3 ? parseInt(hh_end_3) : null,
      })
      .select('id')
      .single()

    if (venueError) {
      console.error('[submit-venue] venue insert error:', venueError)
      return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 })
    }

    const venueId = newVenue.id

    // ── Upload photos (with rollback on failure) ───────────────────────────
    const photoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]

    if (photoFiles.length > 0) {
      const timestamp = Date.now()
      const uploadedUrls: string[] = []

      for (let i = 0; i < photoFiles.length; i++) {
        const photo = photoFiles[i]
        const fileName = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.jpg`
        const filePath = `${venueId}/${timestamp}/${fileName}`

        const buffer = Buffer.from(await photo.arrayBuffer())

        const { error: uploadError } = await supabase.storage
          .from('venue-photos')
          .upload(filePath, buffer, {
            contentType: 'image/jpeg',
            upsert: false
          })

        if (uploadError) {
          // Rollback: delete the partially-created venue
          console.error('[submit-venue] photo upload error — rolling back venue:', uploadError)
          await supabase.from('venues').delete().eq('id', venueId)
          return NextResponse.json({
            success: false,
            reason: 'photo_upload_failed'
          }, { status: 500 })
        }

        const { data: urlData } = supabase.storage
          .from('venue-photos')
          .getPublicUrl(filePath)

        uploadedUrls.push(urlData.publicUrl)
      }

      // Save photo set (max 4 — oldest purged on insert)
      await supabase
        .from('photo_sets')
        .insert({ venue_id: venueId, photo_urls: uploadedUrls })

      // Purge oldest if > 4 sets
      const { data: sets } = await supabase
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

        await supabase.from('photo_sets').delete().in('id', toDelete.map(s => s.id))
        if (storagePaths.length > 0) {
          await supabase.storage.from('venue-photos').remove([...new Set(storagePaths)])
        }
      }

      // Update latest_menu_image_url
      await supabase
        .from('venues')
        .update({ latest_menu_image_url: uploadedUrls[0] })
        .eq('id', venueId)
    }

    // ── Trust + flag management ────────────────────────────────────────────
    await supabase.rpc('clear_flags_on_menu_commit', { p_venue_id: venueId })
    await supabase.rpc('increment_device_submissions', { p_device_hash: deviceHash })

    // ── Fraud signal logging ───────────────────────────────────────────────
    // Log the phone GPS vs EXIF GPS distance to venue_events for fraud analysis
    if (phoneLat != null && phoneLng != null) {
      const phoneLatNum = typeof phoneLat === 'string' ? parseFloat(phoneLat) : phoneLat
      const phoneLngNum = typeof phoneLng === 'string' ? parseFloat(phoneLng) : phoneLng
      if (!isNaN(phoneLatNum) && !isNaN(phoneLngNum)) {
        const distance = haversineM(venueLat, venueLng, phoneLatNum, phoneLngNum)
        // Only log if phone is far from venue (>500m) — indicates possible fraud
        if (distance > 500) {
          await supabase.from('venue_events').insert({
            venue_id: venueId,
            event_type: 'gps_mismatch',
            device_hash: deviceHash,
            lat: phoneLatNum,
            lng: phoneLngNum
          })
        }
      }
    }

    return NextResponse.json({ success: true, venueId })
  } catch (err) {
    console.error('[submit-venue] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Derives the Supabase Storage path from a public URL.
 * e.g. "https://xxx.supabase.co/storage/v1/object/public/venue-photos/..." → "venue-photos/..."
 */
function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

/**
 * POST /api/commit-menu
 *
 * Scan flow: photos + HH schedule (structured) + optional legacy hhTime.
 *
 * Body (multipart/form-data):
 *   venueId?: string
 *   venueName?: string              // required if venueId not provided
 *   lat?: number
 *   lng?: number
 *   deviceHash: string
 *   hhTime?: string                 // legacy: stored in venues.hh_time
 *
 *   // Window 1 (all_day | open_through | typical | late_night)
 *   hh_type?: string
 *   hh_days?: string               // comma-separated ISO weekdays, e.g. "1,2,3,4,5"
 *   hh_exclude_days?: string        // comma-separated ISO weekdays to exclude
 *   hh_start?: string               // minutes since midnight, or empty
 *   hh_end?: string                 // minutes since midnight, or empty
 *
 *   // Window 2
 *   hh_type_2?: string
 *   hh_days_2?: string
 *   hh_exclude_days_2?: string
 *   hh_start_2?: string
 *   hh_end_2?: string
 *
 *   // Window 3
 *   hh_type_3?: string
 *   hh_days_3?: string
 *   hh_exclude_days_3?: string
 *   hh_start_3?: string
 *   hh_end_3?: string
 *
 *   // Venue opening time (minutes since midnight; e.g. 840 = 2pm)
 *   opening_min?: string
 *
 *   photos?: File[]
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const body = Object.fromEntries(formData.entries())

    const {
      venueId,
      venueName,
      lat,
      lng,
      deviceHash,
      hhTime,
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
      hh_end_3,
      opening_min
    } = body as {
      venueId?: string
      venueName?: string
      lat?: string | number
      lng?: string | number
      deviceHash: string
      hhTime?: string
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
      opening_min?: string
    }

    const numLat = typeof lat === 'string' ? parseFloat(lat) : lat
    const numLng = typeof lng === 'string' ? parseFloat(lng) : lng

    if (!deviceHash) {
      return NextResponse.json({ error: 'deviceHash is required' }, { status: 400 })
    }

    let targetVenueId = venueId

    // ── Create venue if not existing ───────────────────────────────────────
    if (!targetVenueId) {
      if (!venueName?.trim()) {
        return NextResponse.json({ error: 'venueName is required for new venues' }, { status: 400 })
      }

      // Geo-dedup: check if a venue with same name exists within 50m
      if (numLat != null && numLng != null) {
        const R = 6371000
        const latRad = numLat * Math.PI / 180
        const { data: nearbyVenues } = await supabase
          .from('venues')
          .select('id, name, lat, lng, status')
          .not('status', 'eq', 'closed')
          .not('lat', 'is', null)
          .not('lng', 'is', null)
          .gte('lat', numLat - (50 / 111320))
          .lte('lat', numLat + (50 / 111320))
          .gte('lng', numLng - (50 / (111320 * Math.cos(latRad))))
          .lte('lng', numLng + (50 / (111320 * Math.cos(latRad))))

        if (nearbyVenues && nearbyVenues.length > 0) {
          const exactMatch = nearbyVenues.find(v => {
            const dLat = (v.lat - numLat) * Math.PI / 180
            const dLng = (v.lng - numLng) * Math.PI / 180
            const a = Math.sin(dLat / 2) ** 2 +
                      Math.cos(latRad) * Math.cos(v.lat * Math.PI / 180) *
                      Math.sin(dLng / 2) ** 2
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
            if (R * c > 50) return false
            // Normalize both names: strip leading "The", lowercase, trim
            const norm = (n: string) => n.replace(/^the\s+/i, '').toLowerCase().trim()
            return norm(v.name) === norm(venueName!)
          })
          if (exactMatch) {
            console.log(`[commit-menu] geo-dedup: using existing venue ${exactMatch.id} for "${venueName}"`)
            targetVenueId = exactMatch.id
          }
        }
      }

      if (!targetVenueId) {
        // Create new venue
        const { data: newVenue, error: venueError } = await supabase
          .from('venues')
          .insert({
            name: venueName!.trim(),
            lat: numLat ?? null,
            lng: numLng ?? null,
            status: 'unverified',
            contributor_trust: 'new',
            menu_text: null,
            latest_menu_image_url: null,
            hh_time: hhTime?.trim() || null,
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
            opening_min: opening_min ? parseInt(opening_min) : null,
          })
          .select('id')
          .single()

        if (venueError) {
          console.error('commit-menu: venue insert error:', venueError)
          return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 })
        }
        targetVenueId = newVenue.id
      }
    } else {
      // ── Update existing venue's HH schedule ─────────────────────────────
      const { error: updateError } = await supabase
        .from('venues')
        .update({
          hh_time: hhTime?.trim() || null,
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
          opening_min: opening_min ? parseInt(opening_min) : null,
        })
        .eq('id', targetVenueId)

      if (updateError) {
        console.error('commit-menu: venue update error:', updateError)
        return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 })
      }
    }

    // ── Upload photos ─────────────────────────────────────────────────────
    const photoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]
    const uploadedUrls: string[] = []

    if (photoFiles.length > 0 && targetVenueId) {
      const timestamp = Date.now()

      for (let i = 0; i < photoFiles.length; i++) {
        const photo = photoFiles[i]
        // Always save as JPEG — file extension reflects original but binary is converted on client
        const fileName = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.jpg`
        // Path is relative to bucket name (bucket = "venue-photos")
        const filePath = `${targetVenueId}/${timestamp}/${fileName}`

        const buffer = Buffer.from(await photo.arrayBuffer())

        const { error: uploadError } = await supabase.storage
          .from('venue-photos')
          .upload(filePath, buffer, {
            contentType: 'image/jpeg',
            upsert: false
          })

        if (uploadError) {
          console.error('commit-menu: photo upload error:', uploadError)
          continue
        }

        const { data: urlData } = supabase.storage
          .from('venue-photos')
          .getPublicUrl(filePath)

        uploadedUrls.push(urlData.publicUrl)
      }

      // Add photo set (max 4 — oldest purged on insert)
      if (uploadedUrls.length > 0) {
        await supabase
          .from('photo_sets')
          .insert({ venue_id: targetVenueId, photo_urls: uploadedUrls })

        // Purge oldest if > 4 sets
        const { data: sets } = await supabase
          .from('photo_sets')
          .select('id, created_at, photo_urls')
          .eq('venue_id', targetVenueId)
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
          .eq('id', targetVenueId)
      }
    }

    // ── Trust + flag management ───────────────────────────────────────────
    if (targetVenueId) {
      await supabase.rpc('clear_flags_on_menu_commit', { p_venue_id: targetVenueId })
      await supabase.rpc('increment_device_submissions', { p_device_hash: deviceHash })
    }

    return NextResponse.json({ venueId: targetVenueId, success: true })
  } catch (err) {
    console.error('commit-menu error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
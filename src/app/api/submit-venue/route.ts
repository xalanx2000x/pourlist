import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reverseGeocodeStructured } from '@/lib/gps'
import { resolveNewSlug } from '@/lib/slug'

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
      seedVenueId,
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
      seedVenueId?: string
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

    // ── Seed venue promotion ──────────────────────────────────────────────
    // When seedVenueId is present, we are promoting an existing seed venue
    // to live status (user confirmed "yes, that's the right venue").
    // This is NOT a new venue creation — reuse the venue, insert photos only.
    if (seedVenueId) {
      const venueLat = typeof exifLat === 'string' ? parseFloat(exifLat) : (exifLat as number)
      const venueLng = typeof exifLng === 'string' ? parseFloat(exifLng) : (exifLng as number)

      // Verify this is actually a seed venue before promoting
      const { data: seedVenue } = await supabase
        .from('venues')
        .select('id, name, is_seed_data, city, state')
        .eq('id', seedVenueId)
        .single()

      if (!seedVenue) {
        return NextResponse.json({ success: false, reason: 'venue_not_found' }, { status: 404 })
      }
      if (seedVenue.is_seed_data !== true) {
        return NextResponse.json({ success: false, reason: 'not_a_seed_venue' }, { status: 400 })
      }

      // ── Rule (b) gate — seed promotion requires photo AND HH ──────────────
      const seedPhotoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]
      if (seedPhotoFiles.length === 0) {
        return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
      }
      const seedHasHh = !!(
        hh_type || hh_days || hh_start || hh_end ||
        hh_type_2 || hh_days_2 || hh_start_2 || hh_end_2 ||
        hh_type_3 || hh_days_3 || hh_start_3 || hh_end_3 ||
        hhSummary
      )
      if (!seedHasHh) {
        return NextResponse.json({ success: false, reason: 'missing_hh' }, { status: 400 })
      }
      // ── end gate ─────────────────────────────────────────────────────────

      // Reverse-geocode GPS → populate city/state before generating slug.
      // This is the root-cause fix: seed venues previously promoted without
      // geo data, landing in limbo with no new_slug.
      // Graceful degradation: promotion still succeeds even if geocode fails.
      // If geocode fails, city/state stay null → needs_geo_review = true, no slug.
      let geoCity: string | null = seedVenue.city ?? null
      let geoState: string | null = seedVenue.state ?? null
      let geoAddress: string | null = null
      let geoStreet: string | null = null
      let geoNeighborhood: string | null = null
      let geoCountry: string | null = null
      let geoZip: string | null = null

      if (!isNaN(venueLat) && !isNaN(venueLng)) {
        try {
          const geo = await reverseGeocodeStructured(venueLat, venueLng)
          if (geo) {
            geoCity = geo.city
            geoState = geo.state
            geoAddress = geo.place_name
            geoStreet = geo.street
            geoNeighborhood = geo.neighborhood
            geoCountry = geo.country
            geoZip = geo.zip
          }
        } catch (err) {
          // Geocode failure: log and continue without geo data
          console.warn('[submit-venue] seed promotion geocode failed:', err)
        }
      }

      // Upload photos (reuse photo list from gate — no re-declare)
      const uploadedUrls: string[] = []
      let uploadFailed = false

      if (seedPhotoFiles.length > 0) {
        const timestamp = Date.now()
        for (let i = 0; i < seedPhotoFiles.length; i++) {
          const photo = seedPhotoFiles[i]
          const fileName = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.jpg`
          const filePath = `${seedVenueId}/${timestamp}/${fileName}`
          const buffer = Buffer.from(await photo.arrayBuffer())

          const { error: uploadError } = await supabase.storage
            .from('venue-photos')
            .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: false })

          if (uploadError) {
            console.error('[submit-venue] seed promotion photo upload error:', uploadError)
            uploadFailed = true
            break
          }

          const { data: urlData } = supabase.storage
            .from('venue-photos')
            .getPublicUrl(filePath)
          uploadedUrls.push(urlData.publicUrl)
        }
      }

      if (uploadFailed) {
        return NextResponse.json({ success: false, reason: 'photo_upload_failed' }, { status: 500 })
      }

      // Build promotion update: is_seed_data=false + geo fields + slug + HH (rule b)
      const promotionUpdate: Record<string, unknown> = {
        is_seed_data: false,
        city: geoCity,
        state: geoState,
        address: geoAddress ?? '',
        street: geoStreet,
        neighborhood: geoNeighborhood,
        country: geoCountry,
        zip: geoZip,
        address_autofilled: geoAddress !== null,
        // HH data — rule (b): graduation captures HH
        hh_updated_at: new Date().toISOString(),
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
      }

      if (uploadedUrls.length > 0) {
        promotionUpdate.latest_menu_image_url = uploadedUrls[0]
      }

      // Generate new_slug — only assigned when geo is complete
      const { path: newSlug, needsGeoReview } = await resolveNewSlug(
        { id: seedVenueId, name: seedVenue.name, city: geoCity, state: geoState },
        supabase
      )
      if (newSlug !== null) {
        promotionUpdate.new_slug = newSlug
        promotionUpdate.needs_geo_review = needsGeoReview
      } else {
        // Geo-incomplete: flag for manual review
        promotionUpdate.needs_geo_review = true
      }

      await supabase.from('venues').update(promotionUpdate).eq('id', seedVenueId)

      // Insert photo set
      if (uploadedUrls.length > 0) {
        await supabase
          .from('photo_sets')
          .insert({ venue_id: seedVenueId, photo_urls: uploadedUrls })

        // Purge oldest if > 4 sets
        const { data: sets } = await supabase
          .from('photo_sets')
          .select('id, created_at, photo_urls')
          .eq('venue_id', seedVenueId)
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
      }

      // Clear flags — venue has been verified by a user
      await supabase.from('flags').delete().eq('venue_id', seedVenueId)

      // Trust + fraud signals (reused from new venue path)
      if (deviceHash) {
        await supabase.rpc('increment_device_submissions', { p_device_hash: deviceHash })
      }
      if (phoneLat != null && phoneLng != null && !isNaN(venueLat) && !isNaN(venueLng)) {
        const phoneLatNum = typeof phoneLat === 'string' ? parseFloat(phoneLat) : (phoneLat as number)
        const phoneLngNum = typeof phoneLng === 'string' ? parseFloat(phoneLng) : (phoneLng as number)
        if (!isNaN(phoneLatNum) && !isNaN(phoneLngNum)) {
          const distance = haversineM(venueLat, venueLng, phoneLatNum, phoneLngNum)
          if (distance > 500) {
            await supabase.from('venue_events').insert({
              venue_id: seedVenueId,
              event_type: 'gps_mismatch',
              device_hash: deviceHash,
              lat: phoneLatNum,
              lng: phoneLngNum
            })
          }
        }
      }

      return NextResponse.json({ success: true, venueId: seedVenueId })
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

    // ── Rule (b) completeness gate — new venues require photo AND HH ───────
    const photoFiles = formData.getAll('photos').filter(f => f && typeof f !== 'string') as File[]
    if (photoFiles.length === 0) {
      return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
    }
    const hasHhInSubmission = !!(
      hh_type || hh_days || hh_start || hh_end ||
      hh_type_2 || hh_days_2 || hh_start_2 || hh_end_2 ||
      hh_type_3 || hh_days_3 || hh_start_3 || hh_end_3 ||
      hhSummary
    )
    if (!hasHhInSubmission) {
      return NextResponse.json({ success: false, reason: 'missing_hh' }, { status: 400 })
    }
    // ── end gate ───────────────────────────────────────────────────────────

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
    // Build the insert payload. We start with empty address fields and
    // let the reverse-geocode hook fill them in if GPS is present.
    const now = new Date().toISOString()
    const venueInsert: Record<string, unknown> = {
      name: venueName.trim(),
      lat: venueLat,
      lng: venueLng,
      status: 'unverified',
      contributor_trust: 'new',
      is_seed_data: false,  // user-created venues are immediately visible
      menu_text: null,
      latest_menu_image_url: null,
      address: '',
      zip: null,
      phone: null,
      website: null,
      type: null,
      hh_summary: hhSummary?.trim() || null,
      hh_updated_at: now, // timestamp of when HH data was first submitted
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
    }

    // New-contribution hook: if we have GPS, reverse-geocode and fill
    // the structured fields. Per-field empty-check: we only fill fields
    // that are currently null/empty. The display string (address) gets
    // the Mapbox place_name, and address_autofilled is set true.
    if (venueLat != null && venueLng != null) {
      const geo = await reverseGeocodeStructured(venueLat, venueLng)
      if (geo) {
        if (venueInsert.address === '' || venueInsert.address == null) {
          venueInsert.address = geo.place_name
        }
        venueInsert.street = geo.street
        venueInsert.city = geo.city
        venueInsert.state = geo.state
        venueInsert.neighborhood = geo.neighborhood
        venueInsert.country = geo.country
        if (geo.zip) venueInsert.zip = geo.zip
        venueInsert.address_autofilled = true
      }
    }

    // Extract city/state for slug generation (from geocode or direct form input).
    // Type-cast needed: venueInsert is Record<string, unknown> so city/state are inferred
    // as {} | null rather than string | null.
    const venueCity = (venueInsert.city as string | null) ?? null
    const venueState = (venueInsert.state as string | null) ?? null

    const { data: newVenue, error: venueError } = await supabase
      .from('venues')
      .insert(venueInsert)
      .select('id')
      .single()

    if (venueError) {
      console.error('[submit-venue] venue insert error:', venueError)
      // Surface the Supabase error message so the client (and the user)
      // can see what actually went wrong. Generic "Failed to create
      // venue" hides the real cause (column mismatch, check constraint,
      // etc).
      return NextResponse.json(
        { error: `Failed to create venue: ${venueError.message}` },
        { status: 500 }
      )
    }

    const venueId = newVenue.id

    // Generate the new SEO-friendly URL slug (/{state}/{city}/{venueSlug}).
    // Gracefully degrades if the new_slug/needs_geo_review columns don't exist
    // yet (migration runs in a later phase — this won't error).
    const { path: newSlug, needsGeoReview } = await resolveNewSlug(
      { id: venueId, name: venueName, city: venueCity, state: venueState },
      supabase
    )

    // Persist slug + geo-review flag.
    // When geo is incomplete, newSlug is null and the venue stays on old /venue/{slug} URL.
    if (newSlug !== null) {
      await supabase
        .from('venues')
        .update({ new_slug: newSlug, needs_geo_review: needsGeoReview })
        .eq('id', venueId)
    } else if (needsGeoReview) {
      await supabase
        .from('venues')
        .update({ needs_geo_review: true })
        .eq('id', venueId)
    }

    // ── Upload photos (with rollback on failure) ───────────────────────────
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

    // Reset HH staleness clock: HH data was just confirmed → hh_updated_at = now
    await supabase
      .from('venues')
      .update({ hh_updated_at: new Date().toISOString() })
      .eq('id', venueId)

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
    // Surface the actual error message so the client can show something
    // useful instead of the generic "Internal server error". Still log
    // the full error server-side for debugging.
    console.error('[submit-venue] error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Server error: ${message}` },
      { status: 500 }
    )
  }
}
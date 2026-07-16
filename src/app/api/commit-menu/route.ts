import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCityCloseMin } from '@/lib/bar-close-times'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Validates that a crossing-midnight window's end does not exceed the city's legal close.
 * Returns an error message string, or null if valid.
 * Rule: late_night/all_day types are exempt. Non-crossing windows (end >= start) are exempt.
 * Only checks: crossing windows (end < start) where end > cityCloseMin.
 */
function validateImpossibleWindow(
  city: string,
  state: string,
  hhType: string | null | undefined,
  hhStart: number | null,
  hhEnd: number | null,
): string | null {
  if (hhType === 'late_night' || hhType === 'all_day') return null
  if (hhStart === null || hhEnd === null) return null
  if (hhStart < hhEnd) return null // does not cross midnight — exempt
  const closeMin = getCityCloseMin(city, state)
  if (hhEnd > closeMin) {
    return 'Invalid timeframe — please check the start and end times.'
  }
  return null
}

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
 *   lat?: number                     // phone GPS — venue location for new venues
 *   lng?: number
 *   phoneAccuracy?: number           // accuracy of the phone GPS
 *   phoneSource?: 'gps' | 'ip'     // required — IP-source rejected for submission
 *   deviceHash: string
 *   hhTime?: string                 // legacy: stored in venues.hh_time
 *
 *   // Window 1 (all_day | typical | late_night)
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
 *   photos?: File[] | base64 data URLs (compressed, preferred)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const body = Object.fromEntries(formData.entries())

    // DEBUG: which endpoint received this submission
    console.log('[commit-menu] HIT', { venueId: body.venueId })

    const {
      venueId,
      venueName,
      lat,
      lng,
      phoneAccuracy,
      phoneSource,
      deviceHash,
      hhTime,
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
      hh_end_3,
      opening_min
    } = body as {
      venueId?: string
      venueName?: string
      lat?: string | number
      lng?: string | number
      phoneAccuracy?: string | number
      phoneSource?: string
      deviceHash: string
      hhTime?: string
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
      opening_min?: string
    }

    const numLat = typeof lat === 'string' ? parseFloat(lat) : lat
    const numLng = typeof lng === 'string' ? parseFloat(lng) : lng
    const numAccuracy = phoneAccuracy != null
      ? (typeof phoneAccuracy === 'string' ? parseFloat(phoneAccuracy) : phoneAccuracy)
      : null

    // Log accuracy so we can verify the value is flowing (VERIFICATION case #7)
    if (numAccuracy != null && !isNaN(numAccuracy)) {
      console.log(`[commit-menu] phoneAccuracy=${numAccuracy.toFixed(1)}m`)
    }

    if (!deviceHash) {
      return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
    }

    // ── Rule (b) completeness gate — validate BEFORE any write ─────────────
    // The client sends photos as base64 data URLs (compressed) for this route.
    // Accept both string (base64) and File entries so the gate matches the upload path below.
    const rawPhotos = formData.getAll('photos').filter(f => f && (typeof f === 'string' || f instanceof File)) as (string | File)[]

    // A photo is ALWAYS required.
    if (rawPhotos.length === 0) {
      return NextResponse.json({ success: false, reason: 'missing_photo' }, { status: 400 })
    }

    // Does THIS submission carry HH data?
    const hasHhInSubmission = !!(
      hh_type || hh_days || hh_start || hh_end ||
      hh_type_2 || hh_days_2 || hh_start_2 || hh_end_2 ||
      hh_type_3 || hh_days_3 || hh_start_3 || hh_end_3 ||
      hhTime || hhSummary
    )

    // Determine whether the venue ALREADY has HH (only relevant for existing venues).
    let venueAlreadyHasHh = false
    if (venueId) {
      const { data: existing } = await supabase
        .from('venues')
        .select('hh_type, hh_time')
        .eq('id', venueId)
        .single()
      venueAlreadyHasHh = !!(existing?.hh_type || existing?.hh_time)
    }

    // HH is required UNLESS the (existing) venue already has it.
    // New venues (no venueId) always require HH via the new-venue path (submit-venue).
    if (!hasHhInSubmission && !venueAlreadyHasHh) {
      return NextResponse.json({ success: false, reason: 'missing_hh' }, { status: 400 })
    }
    // ── end gate ───────────────────────────────────────────────────────────

    // ── Impossible window validation — reject crossing-midnight end > legal close ─
    // Fetch city/state for the target venue (needed for validation).
    // For new venues created inline below, city/state aren't available yet —
    // those go through submit-venue which has geo-resolved city/state.
    let venueCity: string | null = null
    let venueState: string | null = null
    {
      const fetchId = venueId
      if (fetchId) {
        const { data: loc } = await supabase
          .from('venues')
          .select('city, state')
          .eq('id', fetchId)
          .single()
        venueCity = loc?.city ?? null
        venueState = loc?.state ?? null
      }
    }
    if (venueCity && venueState) {
      for (const [t, s, e] of [
        [hh_type, hh_start, hh_end],
        [hh_type_2, hh_start_2, hh_end_2],
        [hh_type_3, hh_start_3, hh_end_3],
      ] as [string | null | undefined, string | null | undefined, string | null | undefined][]) {
        const err = validateImpossibleWindow(
          venueCity, venueState,
          t,
          s != null ? parseInt(s as string) : null,
          e != null ? parseInt(e as string) : null,
        )
        if (err) return NextResponse.json({ success: false, reason: 'invalid_timeframe' }, { status: 400 })
      }
    }

    let targetVenueId = venueId

    // ── Create venue if not existing ───────────────────────────────────────
    if (!targetVenueId) {
      if (!venueName?.trim()) {
        return NextResponse.json({ success: false, reason: 'missing_venue_name' }, { status: 400 })
      }

      // Geo-dedup: check if a venue with same name exists within 15m
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
            if (R * c > 15) return false
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
        // Create new venue (new-venue path uses submit-venue, but commit-menu
        // can also handle the create-venue-on-confirm use case for geo-dedup hits)
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
            opening_min: opening_min ? parseInt(opening_min) : null,
          })
          .select('id')
          .single()

        if (venueError) {
          console.error('commit-menu: venue insert error:', venueError)
          return NextResponse.json({ success: false, reason: 'insert_failed' }, { status: 500 })
        }
        targetVenueId = newVenue.id
      }
    }

    // ── Presence gate (15m) — submitter must be at the venue ───────────────
    // No GPS = cannot verify presence = blocked.
    if (numLat == null || numLng == null || isNaN(numLat) || isNaN(numLng)) {
      return NextResponse.json({ success: false, reason: 'no_gps' }, { status: 400 })
    }
    // Real GPS required — IP geolocation is too coarse for submission.
    if (phoneSource === 'ip') {
      return NextResponse.json({ success: false, reason: 'no_precise_gps' }, { status: 400 })
    }
    {
      const { data: venueLoc } = await supabase
        .from('venues')
        .select('lat, lng')
        .eq('id', targetVenueId)
        .single()
      if (venueLoc?.lat == null || venueLoc?.lng == null) {
        return NextResponse.json({ success: false, reason: 'venue_no_location' }, { status: 400 })
      }
      const R = 6371000
      const dLat = (numLat - venueLoc.lat) * Math.PI / 180
      const dLng = (numLng - venueLoc.lng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(venueLoc.lat * Math.PI / 180) * Math.cos(numLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      // Accuracy-aware presence gate: clamp accuracy to [25, 75] before comparing
      const allowed = Math.min(75, Math.max(25, (numAccuracy != null && !isNaN(numAccuracy)) ? numAccuracy : 25))
      if (distance > allowed) {
        return NextResponse.json({ success: false, reason: 'too_far' }, { status: 400 })
      }
    }
    // ── end presence gate ──────────────────────────────────────────────────

    // ── Update existing venue's HH schedule — merge-safe, never nulls ─────
    // Only write fields that are explicitly provided; leave others untouched.
    if (hasHhInSubmission) {
      const hhUpdate: Record<string, unknown> = {
        hh_updated_at: new Date().toISOString()
      }
      if (hhTime !== undefined) hhUpdate.hh_time = hhTime?.trim() || null
      if (hhSummary !== undefined) hhUpdate.hh_summary = hhSummary?.trim() || null
      if (hh_type !== undefined) hhUpdate.hh_type = hh_type || null
      if (hh_days !== undefined) hhUpdate.hh_days = hh_days || null
      if (hh_exclude_days !== undefined) hhUpdate.hh_exclude_days = hh_exclude_days || null
      if (hh_start !== undefined) hhUpdate.hh_start = hh_start ? parseInt(hh_start) : null
      if (hh_end !== undefined) hhUpdate.hh_end = hh_end ? parseInt(hh_end) : null
      if (hh_type_2 !== undefined) hhUpdate.hh_type_2 = hh_type_2 || null
      if (hh_days_2 !== undefined) hhUpdate.hh_days_2 = hh_days_2 || null
      if (hh_exclude_days_2 !== undefined) hhUpdate.hh_exclude_days_2 = hh_exclude_days_2 || null
      if (hh_start_2 !== undefined) hhUpdate.hh_start_2 = hh_start_2 ? parseInt(hh_start_2) : null
      if (hh_end_2 !== undefined) hhUpdate.hh_end_2 = hh_end_2 ? parseInt(hh_end_2) : null
      if (hh_type_3 !== undefined) hhUpdate.hh_type_3 = hh_type_3 || null
      if (hh_days_3 !== undefined) hhUpdate.hh_days_3 = hh_days_3 || null
      if (hh_exclude_days_3 !== undefined) hhUpdate.hh_exclude_days_3 = hh_exclude_days_3 || null
      if (hh_start_3 !== undefined) hhUpdate.hh_start_3 = hh_start_3 ? parseInt(hh_start_3) : null
      if (hh_end_3 !== undefined) hhUpdate.hh_end_3 = hh_end_3 ? parseInt(hh_end_3) : null
      if (opening_min !== undefined) hhUpdate.opening_min = opening_min ? parseInt(opening_min) : null

      const { error: updateError } = await supabase
        .from('venues')
        .update(hhUpdate)
        .eq('id', targetVenueId)

      if (updateError) {
        console.error('commit-menu: venue update error:', updateError)
        return NextResponse.json({ success: false, reason: 'update_failed' }, { status: 500 })
      }
    }
    // If !hasHhInSubmission but venue already had HH: no HH write needed (photo-only refresh)

    // ── Upload photos ─────────────────────────────────────────────────────
    // photos may be File objects (backward compat) or base64 data URLs (compressed, preferred)
    const uploadedUrls: string[] = []

    if (rawPhotos.length > 0 && targetVenueId) {
      const timestamp = Date.now()

      for (let i = 0; i < rawPhotos.length; i++) {
        const raw: string | File = rawPhotos[i]
        // Decode: support both File objects and base64 data URLs
        let buffer: Buffer
        if (typeof raw === 'string') {
          // base64 data URL → strip mime prefix and decode
          const base64Data = raw.replace(/^data:[^;]+;base64,/, '')
          buffer = Buffer.from(base64Data, 'base64')
        } else {
          // Raw File object (legacy or debug)
          buffer = Buffer.from(await (raw as File).arrayBuffer())
        }

        const fileName = `${timestamp}-${i}-${Math.random().toString(36).slice(2)}.jpg`
        const filePath = `${targetVenueId}/${timestamp}/${fileName}`

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

    // ── Option A: completed presence-gated submission = verification ────────────
    // Never resurrect a closed venue; stale→verified is intended (fresh submission
    // with photo+HH supersedes flags, consistent with clear_flags_on_menu_commit).
    if (targetVenueId) {
      await supabase
        .from('venues')
        .update({
          status: 'verified',
          last_verified: new Date().toISOString(),
        })
        .eq('id', targetVenueId)
        .neq('status', 'closed')
    }

    return NextResponse.json({ venueId: targetVenueId, success: true })
  } catch (err) {
    console.error('commit-menu error:', err)
    return NextResponse.json({ success: false, reason: 'server_error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reverseGeocodeStructured } from '@/lib/gps'
import { resolveNewSlug } from '@/lib/slug'
import tzlookup from 'tz-lookup'
import { getCityCloseMin } from '@/lib/bar-close-times'
import { checkSeedAuth } from '@/lib/seed-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers — copied verbatim from submit-venue/commit-menu. Do not refactor
 * into shared lib per Tyler's standing rule. Submission logic stays inline.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Derives the Supabase Storage path from a public URL.
 */
function storagePathFromUrl(url: string): string {
  const match = url.match(/\/venue-photos\/(.+)$/)
  return match ? `venue-photos/${match[1]}` : ''
}

/**
 * Validates that a crossing-midnight window's end does not exceed the city's legal close.
 * Returns an error message string, or null if valid.
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
 * Map a MIME type to a storage-safe extension. Used for both the filename
 * suffix and the upload contentType (which is set from the same `file.type`).
 *
 * Public routes hardcode `.jpg`/`image/jpeg`; /seed uses the real type to
 * avoid serving PNGs/WebPs with a JPEG mime on the wire.
 */
function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic'
  return 'bin' // honest unknown — better than lying about the type
}

/**
 * HH field names. The form sends three numbered windows plus the bare window 1
 * (in case the form collapses them). We normalize to the numbered columns here.
 */
function readHhFromForm(formData: FormData) {
  // Window 1
  const get = (k: string) => {
    const v = formData.get(k)
    return typeof v === 'string' ? v : ''
  }
  return {
    hhSummary: get('hhSummary'),
    hh_time: get('hhTime'),
    hh_type: get('hh_type'),
    hh_days: get('hh_days'),
    hh_exclude_days: get('hh_exclude_days'),
    hh_start: get('hh_start'),
    hh_end: get('hh_end'),
    hh_type_2: get('hh_type_2'),
    hh_days_2: get('hh_days_2'),
    hh_exclude_days_2: get('hh_exclude_days_2'),
    hh_start_2: get('hh_start_2'),
    hh_end_2: get('hh_end_2'),
    hh_type_3: get('hh_type_3'),
    hh_days_3: get('hh_days_3'),
    hh_exclude_days_3: get('hh_exclude_days_3'),
    hh_start_3: get('hh_start_3'),
    hh_end_3: get('hh_end_3'),
    opening_min: get('opening_min'),
  }
}

function buildHhUpdate(hh: ReturnType<typeof readHhFromForm>) {
  const parseIntOrNull = (s: string) => (s ? parseInt(s, 10) : null)
  const trimOrNull = (s: string) => (s && s.length > 0 ? s : null)
  return {
    hh_updated_at: new Date().toISOString(),
    hh_time: trimOrNull(hh.hh_time),
    hh_summary: trimOrNull(hh.hhSummary),
    hh_type: trimOrNull(hh.hh_type),
    hh_days: trimOrNull(hh.hh_days),
    hh_exclude_days: trimOrNull(hh.hh_exclude_days),
    hh_start: parseIntOrNull(hh.hh_start),
    hh_end: parseIntOrNull(hh.hh_end),
    hh_type_2: trimOrNull(hh.hh_type_2),
    hh_days_2: trimOrNull(hh.hh_days_2),
    hh_exclude_days_2: trimOrNull(hh.hh_exclude_days_2),
    hh_start_2: parseIntOrNull(hh.hh_start_2),
    hh_end_2: parseIntOrNull(hh.hh_end_2),
    hh_type_3: trimOrNull(hh.hh_type_3),
    hh_days_3: trimOrNull(hh.hh_days_3),
    hh_exclude_days_3: trimOrNull(hh.hh_exclude_days_3),
    hh_start_3: parseIntOrNull(hh.hh_start_3),
    hh_end_3: parseIntOrNull(hh.hh_end_3),
    opening_min: parseIntOrNull(hh.opening_min),
  }
}

/**
 * Upload a list of photos to venue-photos storage. Each file's extension and
 * contentType are derived from file.type — no hardcoded image/jpeg.
 *
 * Returns the array of public URLs in upload order.
 */
async function uploadPhotos(
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

      const { error: uploadError } = await supabase.storage
        .from('venue-photos')
        .upload(filePathReal, buffer, { contentType, upsert: false })
      if (uploadError) {
        console.error('[seed] photo upload error:', uploadError)
        return { urls: uploadedUrls, failed: true }
      }
      const { data: urlData } = supabase.storage.from('venue-photos').getPublicUrl(filePathReal)
      uploadedUrls.push(urlData.publicUrl)
      continue
    }

    const { error: uploadError } = await supabase.storage
      .from('venue-photos')
      .upload(filePath, buffer, { contentType, upsert: false })
    if (uploadError) {
      console.error('[seed] photo upload error:', uploadError)
      return { urls: uploadedUrls, failed: true }
    }
    const { data: urlData } = supabase.storage.from('venue-photos').getPublicUrl(filePath)
    uploadedUrls.push(urlData.publicUrl)
  }
  return { urls: uploadedUrls, failed: false }
}

/**
 * Persist a photo set + enforce max-4 retention policy.
 * Mirrors submit-venue/commit-menu exactly.
 */
async function commitPhotoSet(venueId: string, urls: string[]): Promise<void> {
  if (urls.length === 0) return
  await supabase.from('photo_sets').insert({ venue_id: venueId, photo_urls: urls })

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
}

/* ────────────────────────────────────────────────────────────────────────────
 * GET /api/seed/venue?id=X — fetch single venue for prefill
 * ──────────────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ success: false, reason: 'missing_id' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !data) {
    return NextResponse.json({ success: false, reason: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ success: true, venue: data })
}

/* ────────────────────────────────────────────────────────────────────────────
 * POST /api/seed/venue — dispatch on mode
 *
 * Modes:
 *   - new:       create a fresh venue
 *   - edit:      update existing venue (any status; always promotes to verified)
 *   - graduate:  promote seed pin → verified venue (mirrors submit-venue seed branch)
 *   - geocode:   re-run reverseGeocodeStructured on stored lat/lng, update
 *                structured fields + slug. No HH or photo changes.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    console.error('[seed/venue] formData parse error:', err)
    return NextResponse.json({ success: false, reason: 'bad_form' }, { status: 400 })
  }

  const mode = (formData.get('mode') as string | null) ?? ''
  const venueId = (formData.get('venueId') as string | null) ?? null

  try {
    switch (mode) {
      case 'new':       return await handleNew(formData)
      case 'edit':      return await handleEdit(formData, venueId)
      case 'graduate':  return await handleGraduate(formData, venueId)
      case 'geocode':   return await handleGeocode(formData, venueId)
      default:
        return NextResponse.json({ success: false, reason: 'unknown_mode' }, { status: 400 })
    }
  } catch (err) {
    console.error(`[seed/venue] ${mode} handler error:`, err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { success: false, reason: 'server_error', error: message },
      { status: 500 }
    )
  }
}

/* ── Mode: NEW ───────────────────────────────────────────────────────────── */

async function handleNew(formData: FormData) {
  const venueName = (formData.get('venueName') as string | null)?.trim() ?? ''
  if (!venueName) {
    return NextResponse.json({ success: false, reason: 'missing_name' }, { status: 400 })
  }

  // address: Tyler's typed text. Always wins.
  const address = ((formData.get('address') as string | null) ?? '').trim()

  // lat/lng required for new (server needs them to geocode + slug)
  const latStr = formData.get('lat') as string | null
  const lngStr = formData.get('lng') as string | null
  const venueLat = latStr != null ? parseFloat(latStr) : NaN
  const venueLng = lngStr != null ? parseFloat(lngStr) : NaN
  if (isNaN(venueLat) || isNaN(venueLng)) {
    return NextResponse.json({ success: false, reason: 'missing_coords' }, { status: 400 })
  }

  const hh = readHhFromForm(formData)
  const hhUpdate = buildHhUpdate(hh)

  // Impossible-window validation needs city/state. Server computes them via
  // geocode (canonical), so run that first.
  const geo = await reverseGeocodeStructured(venueLat, venueLng)
  const geoCity = geo?.city ?? null
  const geoState = geo?.state ?? null

  if (geoCity && geoState) {
    const err = validateImpossibleWindow(
      geoCity, geoState,
      hhUpdate.hh_type as string | null,
      hhUpdate.hh_start as number | null,
      hhUpdate.hh_end as number | null,
    )
    if (err) return NextResponse.json({ success: false, reason: 'invalid_timeframe' }, { status: 400 })
    const err2 = validateImpossibleWindow(
      geoCity, geoState,
      hhUpdate.hh_type_2 as string | null,
      hhUpdate.hh_start_2 as number | null,
      hhUpdate.hh_end_2 as number | null,
    )
    if (err2) return NextResponse.json({ success: false, reason: 'invalid_timeframe' }, { status: 400 })
    const err3 = validateImpossibleWindow(
      geoCity, geoState,
      hhUpdate.hh_type_3 as string | null,
      hhUpdate.hh_start_3 as number | null,
      hhUpdate.hh_end_3 as number | null,
    )
    if (err3) return NextResponse.json({ success: false, reason: 'invalid_timeframe' }, { status: 400 })
  }

  const now = new Date().toISOString()
  let timezone: string | null = null
  try {
    timezone = tzlookup(venueLat, venueLng)
  } catch { timezone = null }

  const phone = ((formData.get('phone') as string | null) ?? '').trim() || null
  const website = ((formData.get('website') as string | null) ?? '').trim() || null
  const type = ((formData.get('type') as string | null) ?? '').trim() || null

  const venueInsert: Record<string, unknown> = {
    name: venueName,
    address, // Tyler's typed text. Wins over geocoder's place_name.
    lat: venueLat,
    lng: venueLng,
    status: 'verified',
    last_verified: now,
    contributor_trust: 'trusted', // admin-created → mark trusted
    is_seed_data: false,
    address_autofilled: false, // Tyler's text, not geocoder's
    city: geoCity,
    state: geoState,
    neighborhood: geo?.neighborhood ?? null,
    country: geo?.country ?? null,
    zip: geo?.zip ?? null,
    street: geo?.street ?? null,
    phone,
    website,
    type,
    menu_text: ((formData.get('menuText') as string | null) ?? '').trim() || null,
    timezone,
    ...hhUpdate,
  }

  const { data: newVenue, error: venueError } = await supabase
    .from('venues')
    .insert(venueInsert)
    .select('id')
    .single()

  if (venueError) {
    console.error('[seed/new] venue insert error:', venueError)
    return NextResponse.json(
      { success: false, reason: 'insert_failed', error: venueError.message },
      { status: 500 }
    )
  }

  const venueId = newVenue.id as string

  // Resolve slug using geocoder's canonical city/state + Tyler's typed name
  const { path: newSlug, needsGeoReview } = await resolveNewSlug(
    { id: venueId, name: venueName, city: geoCity, state: geoState },
    supabase
  )
  if (newSlug !== null) {
    await supabase.from('venues').update({ new_slug: newSlug, needs_geo_review: needsGeoReview }).eq('id', venueId)
  } else if (needsGeoReview) {
    await supabase.from('venues').update({ needs_geo_review: true }).eq('id', venueId)
  }

  // Photos (optional for admin NEW — Tyler may add later via EDIT)
  const rawPhotos = formData
    .getAll('photos')
    .filter(f => f && (typeof f === 'string' || f instanceof File)) as (string | File)[]
  if (rawPhotos.length > 0) {
    const { urls, failed } = await uploadPhotos(venueId, rawPhotos)
    if (failed) {
      // Photo upload failed mid-stream; keep the venue row, but warn. The row
      // already exists — we don't roll back here because admin creates are
      // expensive (slug + geocode), and Tyler can re-attach photos via EDIT.
      console.warn('[seed/new] partial photo failure — venue row kept')
    } else {
      await commitPhotoSet(venueId, urls)
      if (urls.length > 0) {
        await supabase.from('venues').update({ latest_menu_image_url: urls[0] }).eq('id', venueId)
      }
    }
  }

  // Clear flags in case any exist on this id (paranoia — fresh insert shouldn't have any)
  await supabase.rpc('clear_flags_on_menu_commit', { p_venue_id: venueId })

  return NextResponse.json({ success: true, venueId, mode: 'new' })
}

/* ── Mode: EDIT ──────────────────────────────────────────────────────────── */

async function handleEdit(formData: FormData, venueId: string | null) {
  if (!venueId) {
    return NextResponse.json({ success: false, reason: 'missing_venue_id' }, { status: 400 })
  }

  // Fetch existing row first — needed for lat/lng-change detection AND to
  // honor closed-venue recovery (always set status='verified').
  const { data: existing, error: fetchErr } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single()
  if (fetchErr || !existing) {
    return NextResponse.json({ success: false, reason: 'venue_not_found' }, { status: 404 })
  }

  const venueName = ((formData.get('venueName') as string | null) ?? existing.name)?.trim() ?? existing.name
  const address = ((formData.get('address') as string | null) ?? '').trim()

  const latStr = formData.get('lat') as string | null
  const lngStr = formData.get('lng') as string | null
  const formLat = latStr != null ? parseFloat(latStr) : (existing.lat as number)
  const formLng = lngStr != null ? parseFloat(lngStr) : (existing.lng as number)
  if (typeof formLat !== 'number' || isNaN(formLat) || typeof formLng !== 'number' || isNaN(formLng)) {
    return NextResponse.json({ success: false, reason: 'missing_coords' }, { status: 400 })
  }

  const coordsChanged =
    Math.abs((existing.lat ?? formLat) - formLat) > 1e-7 ||
    Math.abs((existing.lng ?? formLng) - formLng) > 1e-7

  const hh = readHhFromForm(formData)
  const hhUpdate = buildHhUpdate(hh)

  // If lat/lng changed, re-geocode. Otherwise keep existing structured fields.
  let city = (existing.city as string | null) ?? null
  let state = (existing.state as string | null) ?? null
  let neighborhood = (existing.neighborhood as string | null) ?? null
  let country = (existing.country as string | null) ?? null
  let zip = (existing.zip as string | null) ?? null
  let street = (existing.street as string | null) ?? null
  let timezone: string | null = (existing.timezone as string | null) ?? null

  if (coordsChanged) {
    try {
      const geo = await reverseGeocodeStructured(formLat, formLng)
      if (geo) {
        city = geo.city
        state = geo.state
        neighborhood = geo.neighborhood
        country = geo.country
        zip = geo.zip
        street = geo.street
      }
    } catch (err) {
      console.warn('[seed/edit] geocode failed, keeping existing structured fields:', err)
    }
    try {
      timezone = tzlookup(formLat, formLng)
    } catch { /* keep existing */ }
  }

  // Impossible-window validation against current city/state
  if (city && state) {
    for (const [t, s, e] of [
      [hhUpdate.hh_type, hhUpdate.hh_start, hhUpdate.hh_end],
      [hhUpdate.hh_type_2, hhUpdate.hh_start_2, hhUpdate.hh_end_2],
      [hhUpdate.hh_type_3, hhUpdate.hh_start_3, hhUpdate.hh_end_3],
    ] as [string | null, number | null, number | null][]) {
      const err = validateImpossibleWindow(city, state, t, s, e)
      if (err) return NextResponse.json({ success: false, reason: 'invalid_timeframe' }, { status: 400 })
    }
  }

  const phone = ((formData.get('phone') as string | null) ?? '').trim() || null
  const website = ((formData.get('website') as string | null) ?? '').trim() || null
  const type = ((formData.get('type') as string | null) ?? '').trim() || null
  const menuText = ((formData.get('menuText') as string | null) ?? '').trim() || null

  const update: Record<string, unknown> = {
    name: venueName,
    address, // Tyler's typed text. Wins over geocoder's.
    lat: formLat,
    lng: formLng,
    city,
    state,
    neighborhood,
    country,
    zip,
    street,
    timezone,
    phone,
    website,
    type,
    menu_text: menuText,
    address_autofilled: false, // Tyler's text, not geocoder's
    // CLOSED-VENUE RECOVERY: every admin EDIT promotes to verified.
    // - closed  → verified (recovery)
    // - stale   → verified (refresh)
    // - verified → verified (no-op, intentional — keeps semantics consistent)
    status: 'verified',
    last_verified: new Date().toISOString(),
    ...hhUpdate,
  }

  const { error: updateError } = await supabase
    .from('venues')
    .update(update)
    .eq('id', venueId)
  if (updateError) {
    console.error('[seed/edit] venue update error:', updateError)
    return NextResponse.json(
      { success: false, reason: 'update_failed', error: updateError.message },
      { status: 500 }
    )
  }

  // Re-resolve slug if name OR city changed (resolveNewSlug handles per-city uniqueness)
  const nameChanged = existing.name !== venueName
  if (nameChanged || coordsChanged) {
    const { path: newSlug, needsGeoReview } = await resolveNewSlug(
      { id: venueId, name: venueName, city, state },
      supabase
    )
    if (newSlug !== null) {
      await supabase.from('venues').update({ new_slug: newSlug, needs_geo_review: needsGeoReview }).eq('id', venueId)
    } else if (needsGeoReview) {
      await supabase.from('venues').update({ needs_geo_review: true }).eq('id', venueId)
    }
  }

  // Photos (optional — admin may add new menu photos here)
  const rawPhotos = formData
    .getAll('photos')
    .filter(f => f && (typeof f === 'string' || f instanceof File)) as (string | File)[]
  if (rawPhotos.length > 0) {
    const { urls, failed } = await uploadPhotos(venueId, rawPhotos)
    if (failed) {
      console.warn('[seed/edit] partial photo failure — venue row kept')
    } else {
      await commitPhotoSet(venueId, urls)
      if (urls.length > 0) {
        await supabase.from('venues').update({ latest_menu_image_url: urls[0] }).eq('id', venueId)
      }
    }
  }

  // Clear flags — admin edit is an authoritative verification
  await supabase.rpc('clear_flags_on_menu_commit', { p_venue_id: venueId })

  return NextResponse.json({
    success: true,
    venueId,
    mode: 'edit',
    recoveredFrom: existing.status === 'closed' ? 'closed' : null,
  })
}

/* ── Mode: GRADUATE ──────────────────────────────────────────────────────── */

async function handleGraduate(formData: FormData, venueId: string | null) {
  if (!venueId) {
    return NextResponse.json({ success: false, reason: 'missing_venue_id' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single()
  if (fetchErr || !existing) {
    return NextResponse.json({ success: false, reason: 'venue_not_found' }, { status: 404 })
  }
  if (existing.is_seed_data !== true) {
    return NextResponse.json(
      { success: false, reason: 'not_a_seed_venue' },
      { status: 400 }
    )
  }

  // Tyler's typed address — required for graduation
  const address = ((formData.get('address') as string | null) ?? '').trim()
  if (!address) {
    return NextResponse.json({ success: false, reason: 'missing_address' }, { status: 400 })
  }

  // lat/lng: prefer existing (seed venue has them) — allow override
  const latStr = formData.get('lat') as string | null
  const lngStr = formData.get('lng') as string | null
  const formLat = latStr != null ? parseFloat(latStr) : (existing.lat as number | null)
  const formLng = lngStr != null ? parseFloat(lngStr) : (existing.lng as number | null)
  if (typeof formLat !== 'number' || isNaN(formLat) || typeof formLng !== 'number' || isNaN(formLng)) {
    return NextResponse.json({ success: false, reason: 'missing_coords' }, { status: 400 })
  }

  const hh = readHhFromForm(formData)
  const hhUpdate = buildHhUpdate(hh)

  // Re-geocode if coords changed OR seed venue never had structured fields
  let city = (existing.city as string | null) ?? null
  let state = (existing.state as string | null) ?? null
  let neighborhood = (existing.neighborhood as string | null) ?? null
  let country = (existing.country as string | null) ?? null
  let zip = (existing.zip as string | null) ?? null
  let street = (existing.street as string | null) ?? null
  let timezone: string | null = (existing.timezone as string | null) ?? null
  const needsGeo = !city || !state

  if (needsGeo) {
    try {
      const geo = await reverseGeocodeStructured(formLat, formLng)
      if (geo) {
        city = geo.city
        state = geo.state
        neighborhood = geo.neighborhood
        country = geo.country
        zip = geo.zip
        street = geo.street
      }
    } catch (err) {
      console.warn('[seed/graduate] geocode failed:', err)
    }
    try {
      timezone = tzlookup(formLat, formLng)
    } catch { /* keep existing */ }
  }

  // Impossible-window validation
  if (city && state) {
    for (const [t, s, e] of [
      [hhUpdate.hh_type, hhUpdate.hh_start, hhUpdate.hh_end],
      [hhUpdate.hh_type_2, hhUpdate.hh_start_2, hhUpdate.hh_end_2],
      [hhUpdate.hh_type_3, hhUpdate.hh_start_3, hhUpdate.hh_end_3],
    ] as [string | null, number | null, number | null][]) {
      const err = validateImpossibleWindow(city, state, t, s, e)
      if (err) return NextResponse.json({ success: false, reason: 'invalid_timeframe' }, { status: 400 })
    }
  }

  const phone = ((formData.get('phone') as string | null) ?? '').trim() || null
  const website = ((formData.get('website') as string | null) ?? '').trim() || null
  const type = ((formData.get('type') as string | null) ?? '').trim() || null
  const venueName = ((formData.get('venueName') as string | null) ?? existing.name)?.trim() ?? existing.name

  const update: Record<string, unknown> = {
    is_seed_data: false,
    status: 'verified',
    last_verified: new Date().toISOString(),
    name: venueName,
    address, // Tyler's typed text
    lat: formLat,
    lng: formLng,
    city,
    state,
    neighborhood,
    country,
    zip,
    street,
    timezone,
    phone,
    website,
    type,
    menu_text: ((formData.get('menuText') as string | null) ?? '').trim() || null,
    address_autofilled: false,
    ...hhUpdate,
  }

  const { error: updateError } = await supabase
    .from('venues')
    .update(update)
    .eq('id', venueId)
  if (updateError) {
    console.error('[seed/graduate] venue update error:', updateError)
    return NextResponse.json(
      { success: false, reason: 'update_failed', error: updateError.message },
      { status: 500 }
    )
  }

  // Generate slug
  const { path: newSlug, needsGeoReview } = await resolveNewSlug(
    { id: venueId, name: venueName, city, state },
    supabase
  )
  if (newSlug !== null) {
    await supabase.from('venues').update({ new_slug: newSlug, needs_geo_review: needsGeoReview }).eq('id', venueId)
  } else if (needsGeoReview) {
    await supabase.from('venues').update({ needs_geo_review: true }).eq('id', venueId)
  }

  // Photos (optional for graduate)
  const rawPhotos = formData
    .getAll('photos')
    .filter(f => f && (typeof f === 'string' || f instanceof File)) as (string | File)[]
  if (rawPhotos.length > 0) {
    const { urls, failed } = await uploadPhotos(venueId, rawPhotos)
    if (!failed) {
      await commitPhotoSet(venueId, urls)
      if (urls.length > 0) {
        await supabase.from('venues').update({ latest_menu_image_url: urls[0] }).eq('id', venueId)
      }
    }
  }

  // Clear flags — graduation is verification
  await supabase.from('flags').delete().eq('venue_id', venueId)

  return NextResponse.json({ success: true, venueId, mode: 'graduate' })
}

/* ── Mode: GEOCODE ───────────────────────────────────────────────────────── */

async function handleGeocode(formData: FormData, venueId: string | null) {
  if (!venueId) {
    return NextResponse.json({ success: false, reason: 'missing_venue_id' }, { status: 400 })
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single()
  if (fetchErr || !existing) {
    return NextResponse.json({ success: false, reason: 'venue_not_found' }, { status: 404 })
  }

  const lat = existing.lat as number | null
  const lng = existing.lng as number | null
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ success: false, reason: 'no_stored_coords' }, { status: 400 })
  }

  const geo = await reverseGeocodeStructured(lat, lng)
  if (!geo) {
    return NextResponse.json({ success: false, reason: 'geocode_failed' }, { status: 502 })
  }

  let timezone: string | null = null
  try { timezone = tzlookup(lat, lng) } catch { /* leave null */ }

  const update: Record<string, unknown> = {
    city: geo.city,
    state: geo.state,
    neighborhood: geo.neighborhood,
    country: geo.country,
    zip: geo.zip,
    street: geo.street,
    timezone,
    // Note: we do NOT touch `address` here — Tyler's typed text stays.
    // Note: we do NOT touch `status` — GEOCODE is a refresh, not a verification.
  }

  const { error: updateError } = await supabase
    .from('venues')
    .update(update)
    .eq('id', venueId)
  if (updateError) {
    console.error('[seed/geocode] venue update error:', updateError)
    return NextResponse.json(
      { success: false, reason: 'update_failed', error: updateError.message },
      { status: 500 }
    )
  }

  // Re-resolve slug (city may have changed)
  const { path: newSlug, needsGeoReview } = await resolveNewSlug(
    { id: venueId, name: existing.name, city: geo.city, state: geo.state },
    supabase
  )
  if (newSlug !== null) {
    await supabase.from('venues').update({ new_slug: newSlug, needs_geo_review: needsGeoReview }).eq('id', venueId)
  } else if (needsGeoReview) {
    await supabase.from('venues').update({ needs_geo_review: true }).eq('id', venueId)
  }

  return NextResponse.json({
    success: true,
    venueId,
    mode: 'geocode',
    geocoded: {
      city: geo.city,
      state: geo.state,
      neighborhood: geo.neighborhood,
      zip: geo.zip,
      country: geo.country,
      street: geo.street,
    },
  })
}
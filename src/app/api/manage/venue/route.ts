import { NextRequest, NextResponse } from 'next/server'
import { checkVenueAccess } from '@/lib/venue-access'
import { supabaseServer } from '@/lib/supabase-server'
import { getCityCloseMin } from '@/lib/bar-close-times'
import { uploadPhotos, commitPhotoSet, storagePathFromUrl } from '@/lib/photos'

export const dynamic = 'force-dynamic'

// TODO: extract to shared lib — duplicated in 4 routes
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
    return 'Invalid timeframe — please check that the start and end times are possible for your city.'
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const venueId = await checkVenueAccess()
    if (!venueId) {
      return NextResponse.json({ reason: 'unauthorized' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseServer as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: venueData, error: venueError } = await sb
      .from('venues')
      .select(
        'tagline,' +
        'hh_summary, hh_time, opening_min, phone, website,' +
        'hh_type, hh_days, hh_exclude_days, hh_start, hh_end,' +
        'hh_type_2, hh_days_2, hh_exclude_days_2, hh_start_2, hh_end_2,' +
        'hh_type_3, hh_days_3, hh_exclude_days_3, hh_start_3, hh_end_3,' +
        'name, address, city, state, claimed_until,' +
        'latest_menu_image_url'
      )
      .eq('id', venueId)
      .single()

    if (venueError || !venueData) {
      return NextResponse.json({ reason: 'venue_not_found' }, { status: 404 })
    }

    // Fetch photo sets — most recent first, max 4
    const { data: photoSets, error: psError } = await supabaseServer
      .from('photo_sets')
      .select('id, created_at, photo_urls')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(4)

    if (psError) {
      console.error('[manage/venue GET] photo_sets query error', psError)
    }

    const photoSetsPayload = (photoSets ?? []).map(ps => ({
      id: ps.id,
      photoUrls: (ps.photo_urls ?? []) as string[],
      createdAt: ps.created_at,
    }))

    const responsePayload = {
      tagline: venueData.tagline,
      hh_summary: venueData.hh_summary,
      hh_time: venueData.hh_time,
      opening_min: venueData.opening_min,
      phone: venueData.phone,
      website: venueData.website,
      hh_type: venueData.hh_type,
      hh_days: venueData.hh_days,
      hh_exclude_days: venueData.hh_exclude_days,
      hh_start: venueData.hh_start,
      hh_end: venueData.hh_end,
      hh_type_2: venueData.hh_type_2,
      hh_days_2: venueData.hh_days_2,
      hh_exclude_days_2: venueData.hh_exclude_days_2,
      hh_start_2: venueData.hh_start_2,
      hh_end_2: venueData.hh_end_2,
      hh_type_3: venueData.hh_type_3,
      hh_days_3: venueData.hh_days_3,
      hh_exclude_days_3: venueData.hh_exclude_days_3,
      hh_start_3: venueData.hh_start_3,
      hh_end_3: venueData.hh_end_3,
      name: venueData.name,
      address: venueData.address,
      city: venueData.city,
      state: venueData.state,
      claimed_until: venueData.claimed_until,
      latest_menu_image_url: venueData.latest_menu_image_url,
      photoSets: photoSetsPayload,
      latestMenuImageUrl: venueData.latest_menu_image_url ?? null,
    }

    return NextResponse.json(responsePayload)
  } catch (err) {
    console.error('[manage/venue GET]', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ reason: 'server_error', detail: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const venueId = await checkVenueAccess()
    if (!venueId) {
      return NextResponse.json({ reason: 'unauthorized' }, { status: 401 })
    }

    const contentType = req.headers.get('content-type') ?? ''

    // ── Multipart: photo upload + optional field updates ──
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()

      // Extract photos
      const photoFiles: File[] = []
      for (const [key, value] of formData.entries()) {
        if (key === 'photos' && value instanceof File && value.size > 0) {
          photoFiles.push(value)
        }
      }

      // Upload and commit photos if present
      let newPhotoUrls: string[] = []
      if (photoFiles.length > 0) {
        try {
          const uploadResult = await uploadPhotos(venueId, photoFiles)
          newPhotoUrls = uploadResult.urls
          await commitPhotoSet(venueId, newPhotoUrls)
        } catch (photoErr) {
          console.error('[manage/venue PATCH] photo upload error', photoErr)
          return NextResponse.json(
            { reason: 'photo_upload_failed', detail: photoErr instanceof Error ? photoErr.message : String(photoErr) },
            { status: 500 }
          )
        }
      }

      // Extract field updates from form data
      const fields: Record<string, unknown> = {}
      for (const [key, value] of formData.entries()) {
        if (key === 'photos') continue
        if (typeof value === 'string') {
          // Empty string → null (clear field)
          fields[key] = value === '' ? null : value
        } else if (value instanceof File) {
          // Skip files (already handled above)
        } else {
          fields[key] = value
        }
      }

      // If neither photos nor fields, nothing to do
      if (photoFiles.length === 0 && Object.keys(fields).length === 0) {
        return NextResponse.json({ success: true })
      }

      // Apply field updates
      if (Object.keys(fields).length > 0) {
        const fieldResult = await applyFieldUpdates(venueId, fields)
        if (fieldResult) return fieldResult
      }

      // Update latest_menu_image_url if photos were uploaded
      if (newPhotoUrls.length > 0) {
        const { error: urlError } = await supabaseServer
          .from('venues')
          .update({ latest_menu_image_url: newPhotoUrls[0] })
          .eq('id', venueId)
        if (urlError) {
          console.error('[manage/venue PATCH] latest_menu_image_url update error', urlError)
        }
      }

      return NextResponse.json({ success: true, photoCount: newPhotoUrls.length })
    }

    // ── JSON: field updates only ──
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ reason: 'invalid_json' }, { status: 400 })
    }

    const jsonResult = await applyFieldUpdates(venueId, body)
    if (jsonResult) return jsonResult

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[manage/venue PATCH]', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ reason: 'server_error', detail: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const venueId = await checkVenueAccess()
    if (!venueId) {
      return NextResponse.json({ reason: 'unauthorized' }, { status: 401 })
    }

    let body: { photoSetId?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ reason: 'invalid_json' }, { status: 400 })
    }

    const { photoSetId } = body
    if (!photoSetId || typeof photoSetId !== 'string') {
      return NextResponse.json({ reason: 'missing_photoSetId' }, { status: 400 })
    }

    // Fetch the photo set
    const { data: photoSet, error: psFetchError } = await supabaseServer
      .from('photo_sets')
      .select('id, photo_urls')
      .eq('id', photoSetId)
      .single()

    if (psFetchError || !photoSet) {
      return NextResponse.json({ reason: 'photo_set_not_found' }, { status: 404 })
    }

    // Confirm it belongs to the authorized venue
    if ((photoSet as unknown as { venue_id?: string }).venue_id !== venueId) {
      return NextResponse.json({ reason: 'forbidden' }, { status: 403 })
    }

    // Extract storage paths and delete files
    const urls = (photoSet.photo_urls ?? []) as string[]
    if (urls.length > 0) {
      const paths = urls
        .map(url => storagePathFromUrl(url))
        .filter(p => p.length > 0)
      if (paths.length > 0) {
        const { error: storageError } = await supabaseServer.storage
          .from('venue-photos')
          .remove(paths)
        if (storageError) {
          console.error('[manage/venue DELETE] storage delete error', storageError)
        }
      }
    }

    // Delete the photo_sets row
    const { error: psDeleteError } = await supabaseServer
      .from('photo_sets')
      .delete()
      .eq('id', photoSetId)

    if (psDeleteError) {
      console.error('[manage/venue DELETE] row delete error', psDeleteError)
      return NextResponse.json({ reason: 'delete_failed' }, { status: 500 })
    }

    // Query remaining sets — most recent first
    const { data: remainingSets, error: remainingError } = await supabaseServer
      .from('photo_sets')
      .select('id, photo_urls')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })

    if (remainingError) {
      console.error('[manage/venue DELETE] remaining sets query error', remainingError)
    }

    const remainingCount = remainingSets?.length ?? 0
    const newLatestUrl = remainingCount > 0
      ? ((remainingSets![0].photo_urls ?? []) as string[])[0] ?? null
      : null

    // Update latest_menu_image_url
    const { error: urlUpdateError } = await supabaseServer
      .from('venues')
      .update({ latest_menu_image_url: newLatestUrl })
      .eq('id', venueId)

    if (urlUpdateError) {
      console.error('[manage/venue DELETE] latest_menu_image_url update error', urlUpdateError)
    }

    return NextResponse.json({
      success: true,
      latestMenuImageUrl: newLatestUrl,
      remainingSets: remainingCount,
    })
  } catch (err) {
    console.error('[manage/venue DELETE]', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ reason: 'server_error', detail: message }, { status: 500 })
  }
}

/**
 * Shared field-update logic for both JSON and multipart PATCH paths.
 * Returns a NextResponse on error, or null on success.
 */
async function applyFieldUpdates(
  venueId: string,
  body: Record<string, unknown>,
): Promise<NextResponse | null> {
  const {
    tagline,
    hh_summary,
    hh_time,
    opening_min,
    phone,
    website,
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
  } = body as {
    tagline?: string | null
    hh_summary?: string | null
    hh_time?: string | null
    opening_min?: number | string | null
    phone?: string | null
    website?: string | null
    hh_type?: string | null
    hh_days?: string | null
    hh_exclude_days?: string | null
    hh_start?: number | string | null
    hh_end?: number | string | null
    hh_type_2?: string | null
    hh_days_2?: string | null
    hh_exclude_days_2?: string | null
    hh_start_2?: number | string | null
    hh_end_2?: number | string | null
    hh_type_3?: string | null
    hh_days_3?: string | null
    hh_exclude_days_3?: string | null
    hh_start_3?: number | string | null
    hh_end_3?: number | string | null
  }

  // Character limits
  if (tagline !== undefined && tagline !== null && String(tagline).length > 24) {
    return NextResponse.json({ reason: 'tagline_too_long' }, { status: 400 })
  }
  if (hh_summary !== undefined && hh_summary !== null && String(hh_summary).length > 120) {
    return NextResponse.json({ reason: 'hh_summary_too_long' }, { status: 400 })
  }
  if (phone !== undefined && phone !== null && String(phone).length > 200) {
    return NextResponse.json({ reason: 'phone_too_long' }, { status: 400 })
  }
  if (website !== undefined && website !== null && String(website).length > 200) {
    return NextResponse.json({ reason: 'website_too_long' }, { status: 400 })
  }

  // Parse opening_min
  let openingMinValue: number | null = null
  if (opening_min !== undefined && opening_min !== null && opening_min !== '') {
    if (typeof opening_min === 'number') {
      openingMinValue = isNaN(opening_min) ? null : opening_min
    } else {
      const n = parseInt(String(opening_min), 10)
      openingMinValue = isNaN(n) ? null : n
    }
  }

  // Parse HH window minutes — convert to number or null
  function parseMin(v: number | string | null | undefined): number | null {
    if (v === undefined || v === null || v === '') return null
    if (typeof v === 'number') return isNaN(v) ? null : v
    const n = parseInt(v, 10)
    return isNaN(n) ? null : n
  }

  const parsedHhStart = parseMin(hh_start)
  const parsedHhEnd = parseMin(hh_end)
  const parsedHhStart2 = parseMin(hh_start_2)
  const parsedHhEnd2 = parseMin(hh_end_2)
  const parsedHhStart3 = parseMin(hh_start_3)
  const parsedHhEnd3 = parseMin(hh_end_3)

  // Fetch city/state for impossible-window validation
  const { data: venueMeta } = await supabaseServer
    .from('venues')
    .select('city, state')
    .eq('id', venueId)
    .single()

  const city = venueMeta?.city ?? null
  const state = venueMeta?.state ?? null

  // Impossible-window validation for any non-null window
  if (city && state) {
    for (const [t, s, e, label] of [
      [hh_type, parsedHhStart, parsedHhEnd, 'window 1'],
      [hh_type_2, parsedHhStart2, parsedHhEnd2, 'window 2'],
      [hh_type_3, parsedHhStart3, parsedHhEnd3, 'window 3'],
    ] as [string | null | undefined, number | null, number | null, string][]) {
      if (t !== undefined) {
        const err = validateImpossibleWindow(city, state, t, s, e)
        if (err) return NextResponse.json({ reason: 'invalid_timeframe' }, { status: 400 })
      }
    }
  }

  // Determine whether any HH fields are being written
  const hhFields = [
    hh_type, hh_days, hh_exclude_days,
    hh_start, hh_end,
    hh_type_2, hh_days_2, hh_exclude_days_2,
    hh_start_2, hh_end_2,
    hh_type_3, hh_days_3, hh_exclude_days_3,
    hh_start_3, hh_end_3,
    opening_min,
  ]
  const writingHh = hhFields.some(f => f !== undefined)

  // Build update object — merge-safe, only present fields
  const update: Record<string, unknown> = {}

  if (tagline !== undefined) update.tagline = tagline ?? null
  if (hh_summary !== undefined) update.hh_summary = hh_summary ?? null
  if (hh_time !== undefined) update.hh_time = hh_time ?? null
  if (phone !== undefined) update.phone = phone ?? null
  if (website !== undefined) update.website = website ?? null

  if (hh_type !== undefined) update.hh_type = hh_type ?? null
  if (hh_days !== undefined) update.hh_days = hh_days ?? null
  if (hh_exclude_days !== undefined) update.hh_exclude_days = hh_exclude_days ?? null
  if (hh_start !== undefined) update.hh_start = parsedHhStart
  if (hh_end !== undefined) update.hh_end = parsedHhEnd

  if (hh_type_2 !== undefined) update.hh_type_2 = hh_type_2 ?? null
  if (hh_days_2 !== undefined) update.hh_days_2 = hh_days_2 ?? null
  if (hh_exclude_days_2 !== undefined) update.hh_exclude_days_2 = hh_exclude_days_2 ?? null
  if (hh_start_2 !== undefined) update.hh_start_2 = parsedHhStart2
  if (hh_end_2 !== undefined) update.hh_end_2 = parsedHhEnd2

  if (hh_type_3 !== undefined) update.hh_type_3 = hh_type_3 ?? null
  if (hh_days_3 !== undefined) update.hh_days_3 = hh_days_3 ?? null
  if (hh_exclude_days_3 !== undefined) update.hh_exclude_days_3 = hh_exclude_days_3 ?? null
  if (hh_start_3 !== undefined) update.hh_start_3 = parsedHhStart3
  if (hh_end_3 !== undefined) update.hh_end_3 = parsedHhEnd3

  if (opening_min !== undefined) update.opening_min = openingMinValue

  if (writingHh) {
    update.hh_updated_at = new Date().toISOString()
  }

  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabaseServer
      .from('venues')
      .update(update)
      .eq('id', venueId)

    if (updateError) {
      console.error('[manage/venue PATCH]', updateError)
      return NextResponse.json({ reason: 'update_failed' }, { status: 500 })
    }
  }

  return null
}

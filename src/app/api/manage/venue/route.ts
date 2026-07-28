import { NextRequest, NextResponse } from 'next/server'
import { checkVenueAccess } from '@/lib/venue-access'
import { supabaseServer } from '@/lib/supabase-server'
import { getCityCloseMin } from '@/lib/bar-close-times'

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
    return 'Invalid timeframe — please check the start and end times.'
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const venueId = await checkVenueAccess()
    if (!venueId) {
      return NextResponse.json({ reason: 'unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseServer
      .from('venues')
      .select(
        'tagline,' +
        'hh_summary, hh_time, opening_min, phone, website,' +
        'hh_type, hh_days, hh_exclude_days, hh_start, hh_end,' +
        'hh_type_2, hh_days_2, hh_exclude_days_2, hh_start_2, hh_end_2,' +
        'hh_type_3, hh_days_3, hh_exclude_days_3, hh_start_3, hh_end_3,' +
        'name, address, city, state, claimed_until'
      )
      .eq('id', venueId)
      .single()

    if (error || !data) {
      return NextResponse.json({ reason: 'venue_not_found' }, { status: 404 })
    }

    return NextResponse.json(data)
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

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ reason: 'invalid_json' }, { status: 400 })
    }

    // Destructure editable fields; ignore everything else
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
      tagline?: string
      hh_summary?: string
      hh_time?: string
      opening_min?: number | string
      phone?: string
      website?: string
      hh_type?: string
      hh_days?: string
      hh_exclude_days?: string
      hh_start?: number | string
      hh_end?: number | string
      hh_type_2?: string
      hh_days_2?: string
      hh_exclude_days_2?: string
      hh_start_2?: number | string
      hh_end_2?: number | string
      hh_type_3?: string
      hh_days_3?: string
      hh_exclude_days_3?: string
      hh_start_3?: number | string
      hh_end_3?: number | string
    }

    // Character limits
    if (tagline !== undefined && tagline.length > 24) {
      return NextResponse.json({ reason: 'tagline_too_long' }, { status: 400 })
    }
    if (hh_summary !== undefined && hh_summary.length > 120) {
      return NextResponse.json({ reason: 'hh_summary_too_long' }, { status: 400 })
    }
    if (phone !== undefined && phone.length > 200) {
      return NextResponse.json({ reason: 'phone_too_long' }, { status: 400 })
    }
    if (website !== undefined && website.length > 200) {
      return NextResponse.json({ reason: 'website_too_long' }, { status: 400 })
    }

    // Parse opening_min
    let openingMinValue: number | null = null
    if (opening_min !== undefined) {
      if (typeof opening_min === 'number') {
        openingMinValue = isNaN(opening_min) ? null : opening_min
      } else if (typeof opening_min === 'string' && opening_min !== '') {
        const n = parseInt(opening_min, 10)
        openingMinValue = isNaN(n) ? null : n
      }
    }

    // Parse HH window minutes — convert to number or null
    function parseMin(v: number | string | undefined): number | null {
      if (v === undefined || v === '') return null
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

    if (tagline !== undefined) update.tagline = tagline || null
    if (hh_summary !== undefined) update.hh_summary = hh_summary || null
    if (hh_time !== undefined) update.hh_time = hh_time || null
    if (phone !== undefined) update.phone = phone || null
    if (website !== undefined) update.website = website || null

    if (hh_type !== undefined) update.hh_type = hh_type || null
    if (hh_days !== undefined) update.hh_days = hh_days || null
    if (hh_exclude_days !== undefined) update.hh_exclude_days = hh_exclude_days || null
    if (hh_start !== undefined) update.hh_start = parsedHhStart
    if (hh_end !== undefined) update.hh_end = parsedHhEnd

    if (hh_type_2 !== undefined) update.hh_type_2 = hh_type_2 || null
    if (hh_days_2 !== undefined) update.hh_days_2 = hh_days_2 || null
    if (hh_exclude_days_2 !== undefined) update.hh_exclude_days_2 = hh_exclude_days_2 || null
    if (hh_start_2 !== undefined) update.hh_start_2 = parsedHhStart2
    if (hh_end_2 !== undefined) update.hh_end_2 = parsedHhEnd2

    if (hh_type_3 !== undefined) update.hh_type_3 = hh_type_3 || null
    if (hh_days_3 !== undefined) update.hh_days_3 = hh_days_3 || null
    if (hh_exclude_days_3 !== undefined) update.hh_exclude_days_3 = hh_exclude_days_3 || null
    if (hh_start_3 !== undefined) update.hh_start_3 = parsedHhStart3
    if (hh_end_3 !== undefined) update.hh_end_3 = parsedHhEnd3

    if (opening_min !== undefined) update.opening_min = openingMinValue

    if (writingHh) {
      update.hh_updated_at = new Date().toISOString()
    }

    const { error: updateError } = await supabaseServer
      .from('venues')
      .update(update)
      .eq('id', venueId)

    if (updateError) {
      console.error('[manage/venue PATCH]', updateError)
      return NextResponse.json({ reason: 'update_failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[manage/venue PATCH]', err)
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ reason: 'server_error', detail: message }, { status: 500 })
  }
}

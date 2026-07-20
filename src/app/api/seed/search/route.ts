import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkSeedAuth } from '@/lib/seed-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * GET /api/seed/search?q=foo
 *
 * Substring match on venue name, plus optional city filter. Returns up to
 * 25 rows with the fields needed for the picker UI (status badge, is_seed,
 * lat/lng for GEOCODE).
 *
 * Closed venues are NOT excluded — Tyler needs to find them to recover them.
 */
export async function GET(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const city = (url.searchParams.get('city') || '').trim()

  if (q.length < 2) {
    return NextResponse.json(
      { success: false, reason: 'query_too_short' },
      { status: 400 }
    )
  }

  let query = supabase
    .from('venues')
    .select('id, name, address, city, state, status, is_seed_data, lat, lng, slug, new_slug, last_verified')
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(25)

  if (city.length > 0) {
    query = query.ilike('city', `%${city}%`)
  }

  const { data, error } = await query

  if (error) {
    console.error('[seed/search] error:', error)
    return NextResponse.json(
      { success: false, reason: 'search_failed', error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, venues: data ?? [] })
}
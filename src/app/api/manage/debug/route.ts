import { NextResponse } from 'next/server'
import { checkVenueAccess } from '@/lib/venue-access'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const venueId = await checkVenueAccess()
  if (!venueId) {
    return NextResponse.json({ checkVenueAccess: null, step: 'checkFailed' }, { status: 401 })
  }
  return NextResponse.json({ checkVenueAccess: venueId })
}

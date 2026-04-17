import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/create-venue
 * Body: { name: string; lat?: number; lng?: number; address?: string; deviceHash: string }
 * Creates a new venue and returns the venue object.
 */
export async function POST(req: NextRequest) {
  try {
    const { name, lat, lng, address, deviceHash } = await req.json()

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Venue name is required' }, { status: 400 })
    }

    if (!deviceHash || typeof deviceHash !== 'string') {
      return NextResponse.json({ error: 'deviceHash is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('venues')
      .insert({
        name: name.trim(),
        lat: lat ?? null,
        lng: lng ?? null,
        address_backup: address ?? null,
        status: 'unverified',
        contributor_trust: 'new',
        zip: null,
        phone: null,
        website: null,
        type: null,
        menu_text: null,
        latest_menu_image_url: null
      })
      .select()
      .single()

    if (error) {
      console.error('create-venue error:', error)
      return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('create-venue error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/submit-menu
 * Body: { menuText: string; venueId?: string; venueName?: string; address?: string;
 *         lat?: number; lng?: number; photoHash?: string; deviceHash: string }
 * Creates a new venue if venueId is not provided, then saves the menu text.
 */
export async function POST(req: NextRequest) {
  try {
    const {
      menuText,
      venueId,
      venueName,
      address,
      lat,
      lng,
      photoHash,
      deviceHash,
      imageUrl
    } = await req.json()

    // Allow submission even without extracted text (user can edit later or AI failed to read image)

    let targetVenueId = venueId

    // Create new venue if no venueId provided
    if (!targetVenueId) {
      if (!venueName?.trim() || !address?.trim()) {
        return NextResponse.json(
          { error: 'venueName and address are required for new venues' },
          { status: 400 }
        )
      }

      // Reverse geocode if we have coords but no address
      let finalAddress = address
      if (lat && lng && !address) {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
            { headers: { 'User-Agent': 'PourList/1.0' } }
          )
          const data = await res.json()
          if (data.display_name) {
            finalAddress = data.display_name.split(', ').slice(0, 3).join(', ')
          }
        } catch {
          // Use provided address
        }
      }

      const { data: newVenue, error: venueError } = await supabase
        .from('venues')
        .insert({
          name: venueName.trim(),
          address: finalAddress,
          lat: lat || null,
          lng: lng || null,
          zip: '97209',
          status: 'unverified',
          contributor_trust: deviceHash ? 'new' : 'anonymous',
          menu_text: menuText.trim(),
          menu_text_updated_at: new Date().toISOString()
        })
        .select('id')
        .single()

      if (venueError) {
        console.error('Venue insert error:', venueError)
        return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 })
      }

      targetVenueId = newVenue.id
    } else {
      // Update existing venue with new menu text
      const updateFields: Record<string, unknown> = {
        menu_text: menuText.trim(),
        menu_text_updated_at: new Date().toISOString()
      }

      const { error: updateError } = await supabase
        .from('venues')
        .update(updateFields)
        .eq('id', targetVenueId)

      if (updateError) {
        console.error('Menu update error:', updateError)
        return NextResponse.json({ error: 'Failed to update menu' }, { status: 500 })
      }
    }

    return NextResponse.json({ venueId: targetVenueId, success: true })
  } catch (err) {
    console.error('Submit menu error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

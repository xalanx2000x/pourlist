import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

/**
 * Calculate distance between two lat/lng points in meters using Haversine formula.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Reverse geocode lat/lng → address string.
 * Primary: Mapbox Geocoding API. Fallback: Nominatim.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  // Mapbox primary
  if (MAPBOX_TOKEN) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.features?.[0]?.place_name) return data.features[0].place_name
      }
    } catch { /* fall through */ }
  }
  // Nominatim fallback
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'User-Agent': 'PourList/1.0' } }
    )
    const data = await res.json()
    if (data.display_name) return data.display_name
  } catch { /* both failed */ }
  return null
}

/**
 * Basic HTML escape to prevent stored XSS.
 * Since venue data (including menu_text) is publicly readable,
 * we must escape < > & " ' before storing to prevent script injection.
 */
function sanitizeMenuText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * POST /api/submit-menu
 * Body: { menuText: string; venueId?: string; venueName?: string; address?: string;
 *         lat?: number; lng?: number; deviceHash: string; imageUrl?: string }
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
      photoLat,
      photoLng,
      deviceHash,
      imageUrl
    } = await req.json()

    // ---- Input validation & sanitization ----
    // Sanitize menu_text: max 10,000 chars + HTML escape to prevent stored XSS.
    // Venue data is publicly readable, so script injection is a real risk.
    if (!menuText || typeof menuText !== 'string') {
      return NextResponse.json({ error: 'menuText is required' }, { status: 400 })
    }
    if (menuText.length > 10000) {
      return NextResponse.json(
        { error: 'menuText exceeds maximum length of 10,000 characters' },
        { status: 400 }
      )
    }
    const sanitizedMenuText = sanitizeMenuText(menuText)

    // Server-side rate limit check (fail-open)
    if (deviceHash) {
      try {
        const rateLimitRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL}/api/rate-limit-check`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'submit-menu', deviceHash })
          }
        )
        if (rateLimitRes.ok) {
          const { allowed } = await rateLimitRes.json() as { allowed: boolean }
          if (!allowed) {
            return NextResponse.json(
              { error: 'Too many requests. Please wait a moment before trying again.' },
              { status: 429 }
            )
          }
        }
      } catch {
        // Fail open — don't block submission if rate-limit service is unreachable
      }
    }

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
      if (!finalAddress) {
        if (lat && lng) {
          const geocoded = await reverseGeocode(lat, lng)
          if (geocoded) finalAddress = geocoded.split(', ').slice(0, 3).join(', ')
        } else if (photoLat && photoLng) {
          const geocoded = await reverseGeocode(photoLat, photoLng)
          if (geocoded) finalAddress = geocoded.split(', ').slice(0, 3).join(', ')
        }
      }

      const { data: newVenue, error: venueError } = await supabase
        .from('venues')
        .insert({
          name: venueName.trim(),
          address_backup: finalAddress,
          // lat/lng intentionally not stored — venue coords come from address geocoding only
          zip: null,
          status: 'unverified',
          contributor_trust: deviceHash ? 'new' : 'anonymous',
          menu_text: sanitizedMenuText.trim(),
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
        menu_text: sanitizedMenuText.trim(),
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

      // Geo-check: verify photo location is within 50m of venue location
      if (photoLat != null && photoLng != null) {
        const { data: venue } = await supabase
          .from('venues')
          .select('lat, lng')
          .eq('id', targetVenueId)
          .single()

        if (venue?.lat != null && venue?.lng != null) {
          const distance = haversineDistance(photoLat, photoLng, venue.lat, venue.lng)
          if (distance > 50) {
            return NextResponse.json(
              { error: 'Unable to verify location. Please ensure you are standing at the venue.' },
              { status: 400 }
            )
          }
          // Geo-check passed — update most recent photo for this venue by this device
          if (deviceHash) {
            await supabase
              .from('photos')
              .update({ location_verified: true })
              .eq('venue_id', targetVenueId)
              .eq('uploader_device_hash', deviceHash)
              .is('location_verified', null)
              .order('created_at', { ascending: false })
              .limit(1)
          }
        }
      }
    }

    return NextResponse.json({ venueId: targetVenueId, success: true })
  } catch (err) {
    console.error('Submit menu error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
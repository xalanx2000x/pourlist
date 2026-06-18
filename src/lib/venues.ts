import { supabase, Venue } from './supabase'
import { reverseGeocodeStructured } from './gps'
import { haversineM } from './geo'

export type PhotoSet = {
  id: string
  venue_id: string
  created_at: string
  photo_urls: string[]
}

export async function getVenuesByZip(zip: string): Promise<Venue[]> {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('zip', zip)
    .neq('status', 'closed')
    .order('name')

  if (error) throw error
  return data || []
}

export async function getVenuesByProximity(
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<Venue[]> {
  const bboxLatDelta = radiusMeters / 111320
  const bboxLngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180))

  // Bbox prefilter keeps the wire small. We then compute exact
  // Haversine distance in JS, sort nearest-first, and return the
  // top 100. The list view re-sorts on the client by the current
  // loaded-area center — see page.tsx visibleVenues — so the
  // server order is a snapshot of "100 closest to the query center
  // at fetch time." `.order('name')` is kept so dedup is stable
  // (deterministic choice between same-status duplicates).
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .neq('status', 'closed')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .gte('lat', lat - bboxLatDelta)
    .lte('lat', lat + bboxLatDelta)
    .gte('lng', lng - bboxLngDelta)
    .lte('lng', lng + bboxLngDelta)
    .order('name')
    .limit(1000)

  if (error) throw error
  if (!data) return []

  // Filter by exact Haversine distance (rectangular bbox is wider than radius)
  const filtered = (data as Venue[]).filter(v => {
    if (v.lat == null || v.lng == null) return false
    return haversineM(lat, lng, v.lat, v.lng) <= radiusMeters
  })

  // Deduplicate by name (case-insensitive, strip leading "The"):
  // Keep the venue with the best status (verified > stale > unverified > new)
  const statusRank: Record<string, number> = { verified: 0, stale: 1, unverified: 2, new: 3 }
  const seen = new Map<string, Venue>()
  for (const v of filtered) {
    const key = v.name.replace(/^the\s+/i, '').toLowerCase().trim()
    const existing = seen.get(key)
    if (!existing || (statusRank[existing.status] ?? 3) > (statusRank[v.status] ?? 3)) {
      seen.set(key, v)
    }
  }
  const deduped = Array.from(seen.values())

  // Sort by distance, nearest first, and cap to 100.
  return deduped
    .filter((v): v is Venue & { lat: number; lng: number } =>
      v.lat != null && v.lng != null
    )
    .sort((a, b) =>
      haversineM(lat, lng, a.lat, a.lng) - haversineM(lat, lng, b.lat, b.lng)
    )
    .slice(0, 100)
}

export async function getVenueById(id: string): Promise<Venue | null> {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

/**
 * Client-side slug lookup. Used by the map's deep-link resolver
 * (?venue={slug} on the map). Returns null on bad/old/deleted slugs
 * so the caller can degrade silently to the normal GPS-based map load.
 */
export async function getVenueBySlugClient(slug: string): Promise<Venue | null> {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('getVenueBySlugClient failed:', error)
    return null
  }
  return (data as Venue) ?? null
}

export async function addVenue(venue: Partial<Venue>): Promise<Venue> {
  const { data, error } = await supabase
    .from('venues')
    .insert([venue])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getVenuePhotos(venueId: string) {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('venue_id', venueId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function submitPhoto(
  photoUrl: string,
  venueId: string,
  deviceHash: string,
  lat?: number,
  lng?: number
) {
  const { data, error } = await supabase
    .from('photos')
    .insert([{
      venue_id: venueId,
      url: photoUrl,
      uploader_device_hash: deviceHash,
      lat,
      lng,
      status: 'pending'
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function flagContent(
  venueId: string | null,
  photoId: string | null,
  reason: string,
  deviceHash: string
) {
  const { data, error } = await supabase
    .from('flags')
    .insert([{
      venue_id: venueId,
      photo_id: photoId,
      reason,
      device_hash: deviceHash
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Create a new venue for the scan flow.
 * GPS is stored directly (unlike addVenue which omits lat/lng).
 *
 * New-contribution hook: if lat/lng are present and `address` is empty,
 * reverse-geocode the coords and fill the structured fields
 * (street/city/state/neighborhood/country/zip) plus the display string.
 * Each field is checked for emptiness before writing — we never
 * overwrite anything that already has a value. The Mapbox token is
 * NEXT_PUBLIC_* so it's safe to call from the client.
 */
export async function createVenueForScan(params: {
  name: string
  lat: number | null
  lng: number | null
  address: string | null
  deviceHash: string
}): Promise<Venue> {
  // Build the insert payload. Start with the fields we always know.
  const insert: Record<string, unknown> = {
    name: params.name.trim(),
    lat: params.lat,
    lng: params.lng,
    address: params.address ?? null,
    status: 'unverified',
    contributor_trust: 'new',
    zip: null,
    phone: null,
    website: null,
    type: null,
    menu_text: null,
    latest_menu_image_url: null
  }

  // Hook: reverse-geocode if we have GPS and no user-typed address.
  // Per-field empty-check: we only fill fields that are currently null.
  if (params.lat != null && params.lng != null && (params.address == null || params.address === '')) {
    const geo = await reverseGeocodeStructured(params.lat, params.lng)
    if (geo) {
      if (insert.address == null || insert.address === '') insert.address = geo.place_name
      insert.street = geo.street
      insert.city = geo.city
      insert.state = geo.state
      insert.neighborhood = geo.neighborhood
      insert.country = geo.country
      if (geo.zip) insert.zip = geo.zip
      insert.address_autofilled = true
    }
  }

  const { data, error } = await supabase
    .from('venues')
    .insert(insert)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Add a photo set to a venue.
 * If the venue now has more than 4 photo sets, the oldest one is deleted.
 */
export async function addPhotoSet(
  venueId: string,
  photoUrls: string[]
): Promise<void> {
  // Insert the new photo set
  const { error: insertError } = await supabase
    .from('photo_sets')
    .insert({
      venue_id: venueId,
      photo_urls: photoUrls
    })

  if (insertError) throw insertError

  // Count photo sets for this venue
  const { data: sets, error: countError } = await supabase
    .from('photo_sets')
    .select('id, created_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })

  if (countError) throw countError

  // If more than 4, delete the oldest ones
  if (sets && sets.length > 4) {
    const toDelete = sets.slice(4).map(s => s.id)
    const { error: deleteError } = await supabase
      .from('photo_sets')
      .delete()
      .in('id', toDelete)

    if (deleteError) console.error('Failed to delete old photo sets:', deleteError)
  }
}

/**
 * Get the 4 most recent photo sets for a venue.
 */
export async function getPhotoSets(venueId: string): Promise<PhotoSet[]> {
  const { data, error } = await supabase
    .from('photo_sets')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(4)

  if (error) throw error
  return (data as PhotoSet[]) || []
}

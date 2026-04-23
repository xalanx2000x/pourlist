import { supabase, Venue } from './supabase'

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

  // Fetch up to 10,000 rows to handle large national seed data.
  // The Supabase JS client caps at 1,000 by default, which skips
  // alphabetically-late venues (like "Paymaster") even when they
  // fall within the geographic radius. The Haversine filter below
  // still ensures only truly nearby venues are returned.
  let allVenues: Venue[] = []
  const PAGE_SIZE = 5000

  for (let page = 0; page < 2; page++) {
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
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    allVenues = allVenues.concat(data as Venue[])
    if (data.length < PAGE_SIZE) break
  }

  // Filter by exact Haversine distance (rectangular bbox is wider than radius)
  const filtered = allVenues.filter(v => {
    if (v.lat == null || v.lng == null) return false
    const R = 6371000
    const dLat = (v.lat - lat) * Math.PI / 180
    const dLng = (v.lng - lng) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * Math.PI / 180) *
        Math.cos(v.lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c <= radiusMeters
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

  return deduped.sort((a, b) => a.name.localeCompare(b.name))
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
 */
export async function createVenueForScan(params: {
  name: string
  lat: number | null
  lng: number | null
  address: string | null
  deviceHash: string
}): Promise<Venue> {
  const { data, error } = await supabase
    .from('venues')
    .insert({
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
    })
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

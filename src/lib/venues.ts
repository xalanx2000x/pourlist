import { supabase, Venue } from './supabase'
import { reverseGeocodeStructured } from './gps'
import { haversineM } from './geo'
import tzlookup from 'tz-lookup'

// ─── Shared status predicates ─────────────────────────────────────────────────

/** Map visibility: closed venues are invisible everywhere; verified, stale, and
 * unverified all show as pins (unverified gets a "New" badge). */
export function isMapVisible(venue: { status?: string | null }): boolean {
  return venue.status !== 'closed'
}

/** Listing eligibility: only verified and stale venues appear in public lists,
 * sidebar, neighborhood counts, and SEO pages. Unverified and closed are excluded. */
export function isListed(venue: { status?: string | null }): boolean {
  const s = venue.status ?? 'unverified'
  return s === 'verified' || s === 'stale'
}

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

/**
 * Lean venue — fields the map and list render. The card detail view
 * (`VenueDetail`) does a separate full fetch via `getVenueById` when
 * a venue is selected, so we can defer menu_text, hh_summary, audit
 * fields, and the rest until the user actually opens the card. This
 * keeps the wire ~30% smaller per row, and the cap of `limit`
 * venues per fetch keeps the total bounded too.
 */
export type LeanVenue = {
  id: string
  name: string
  slug: string | null
  lat: number | null
  lng: number | null
  address: string | null
  city: string | null
  state: string | null
  neighborhood: string | null
  country: string | null
  zip: string | null
  address_autofilled: boolean
  hh_type: string | null
  hh_days: string | null
  hh_exclude_days: string | null
  hh_start: number | null
  hh_end: number | null
  hh_type_2: string | null
  hh_days_2: string | null
  hh_exclude_days_2: string | null
  hh_start_2: number | null
  hh_end_2: number | null
  hh_type_3: string | null
  hh_days_3: string | null
  hh_exclude_days_3: string | null
  hh_start_3: number | null
  hh_end_3: number | null
  hh_time: string | null
  status: 'unverified' | 'verified' | 'stale' | 'closed'
  is_seed_data: boolean
  type: string | null
  latest_menu_image_url: string | null
  timezone: string | null
  // Optional fields — the lean fetch doesn't return these, but
  // downstream functions (dealSummary, getHhLabel) accept the
  // Venue | LeanVenue union and gracefully skip them when missing.
  menu_text?: string | null
  hh_summary?: string | null
}

export type VenueBounds = {
  north: number
  south: number
  east: number
  west: number
}

export type VenuesInBoundsResult = {
  venues: LeanVenue[]
  /** Always false — the RPC enforces the cap so all returned venues are
   *  within the distance budget. The "zoom in" hint is no longer needed.
   *  Kept for API compat. */
  capped: boolean
}

/**
 * Fetch the venues whose coords fall within the given viewport bounds,
 * up to `limit` rows. The result is sorted nearest-first by Haversine
 * distance from the bounds' centroid.
 *
 * The map's `moveend` event (debounced 150ms) is the trigger; the list
 * re-sorts on the client by the bounds' centroid to handle minor GPS
 * drift between fetch and render. Clustering is handled at the map
 * layer (Mapbox cluster source) so dense viewports degrade gracefully
 * without pulling thousands of rows.
 */
export async function getVenuesInBounds(
  north: number,
  south: number,
  east: number,
  west: number,
  limit: number = 150
): Promise<VenuesInBoundsResult> {
  const centerLat = (north + south) / 2
  const centerLng = (east + west) / 2

  // RPC orders by weighted squared-distance from viewport center.
  // Real venues (is_seed_data=false) have no cap — always returned in full.
  // Seed pins fill remaining budget (p_limit - real_count), capped at p_limit total.
  // Distance is weighted by cos(radians(center_lat)) so lng contribution is
  // proportional to true ground distance — correct at any latitude.
  const { data, error } = await supabase.rpc('get_venues_in_bounds', {
    p_north: north,
    p_south: south,
    p_east: east,
    p_west: west,
    p_center_lat: centerLat,
    p_center_lng: centerLng,
    p_limit: limit,
  })

  if (error) throw error
  const rows = (data ?? []) as (LeanVenue & { dist_sq: number })[]

  // Deduplicate by name (case-insensitive, strip leading "The"):
  // Keep the venue with the best status (verified > stale > unverified > new).
  // The RPC already ordered by distance — first occurrence of each dedup
  // key is the nearest venue, so ordering is preserved through dedup.
  const statusRank: Record<string, number> = { verified: 0, stale: 1, unverified: 2, new: 3 }
  const seen = new Map<string, LeanVenue & { dist_sq: number }>()
  for (const v of rows) {
    const key = v.name.replace(/^the\s+/i, '').toLowerCase().trim()
    const existing = seen.get(key)
    if (!existing || (statusRank[existing.status] ?? 3) > (statusRank[v.status] ?? 3)) {
      seen.set(key, v)
    }
  }
  const deduped = Array.from(seen.values())

  return {
    venues: deduped,
    // Always false — the RPC guarantees total rows ≤ p_limit by giving real
    // venues unlimited rows and seeds only the remaining budget.
    capped: false
  }
}

/**
 * Tight-radius full-venue lookup, used by the scan flow's
 * "is this venue at my location?" checks and the seed-match
 * detection. Returns the full venue (not the lean shape) so the
 * scan state can hold a complete record. Not used for the list
 * or map — those use getVenuesInBounds (lean, capped at 150).
 */
export async function getVenuesByProximity(
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<Venue[]> {
  const bboxLatDelta = radiusMeters / 111320
  const bboxLngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180))

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
    .limit(200)

  if (error) throw error
  if (!data) return []

  return (data as Venue[]).filter(v =>
    v.lat != null && v.lng != null &&
    haversineM(lat, lng, v.lat, v.lng) <= radiusMeters
  )
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
    latest_menu_image_url: null,
    timezone: (() => {
      try {
        return params.lat != null && params.lng != null ? tzlookup(params.lat, params.lng) : null
      } catch { return null }
    })(),
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
 * ensureStructuredGeo — single chokepoint where coordinates become structured geo.
 *
 * Trigger: venue has lat+lng AND (city IS NULL OR state IS NULL).
 *         This catches partial ghosts (one field missing) and full ghosts (both null).
 *
 * On success:  populates city/state/neighborhood/country/zip/street/address,
 *              sets needs_geo_review=false, is_seed_data=false.
 * On failure:  sets needs_geo_review=true (flagged for manual review, not a crash).
 *              Graduation still completes.
 *
 * Call this at every graduation moment — when a venue first gets both HH data
 * AND a photo (the two-piece bar), before returning success to the client.
 */
export async function ensureStructuredGeo(venueId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data, error } = await db
    .from('venues')
    .select('id, lat, lng, city, state')
    .eq('id', venueId)
    .single()

  const venue = data as { id: string; lat: number | null; lng: number | null; city: string | null; state: string | null } | null
  if (error || !venue) return

  const hasCoords = venue.lat != null && venue.lng != null
  const geoIncomplete = venue.city == null || venue.state == null

  if (!hasCoords || !geoIncomplete) return

  try {
    const geo = await reverseGeocodeStructured(venue.lat!, venue.lng!)
    if (!geo) throw new Error('geocode returned null')

    await db
      .from('venues')
      .update({
        city: geo.city,
        state: geo.state,
        neighborhood: geo.neighborhood,
        country: geo.country,
        street: geo.street,
        zip: geo.zip ?? null,
        address: geo.place_name,
        address_autofilled: true,
        needs_geo_review: false,
        is_seed_data: false,
      })
      .eq('id', venueId)
  } catch (err) {
    // Geocode failed — flag for manual review, graduation still completes
    console.warn('[ensureStructuredGeo] geocode failed for', venueId, err)
    await db.from('venues').update({ needs_geo_review: true }).eq('id', venueId)
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

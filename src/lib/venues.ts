import { supabase, Venue } from './supabase'

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
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .neq('status', 'closed')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .gte('lat', lat - (radiusMeters / 111320))
    .lte('lat', lat + (radiusMeters / 111320))
    .gte('lng', lng - (radiusMeters / (111320 * Math.cos(lat * Math.PI / 180))))
    .lte('lng', lng + (radiusMeters / (111320 * Math.cos(lat * Math.PI / 180))))

  if (error) throw error

  // Filter by exact Haversine distance (rectangular bbox is wider than radius)
  const filtered = (data || []).filter(v => {
    const R = 6371000
    const dLat = (v.lat - lat) * Math.PI / 180
    const dLng = (v.lng - lng) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat * Math.PI/180) * Math.cos(v.lat * Math.PI/180) *
              Math.sin(dLng/2)**2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c <= radiusMeters
  })

  return filtered.sort((a, b) => a.name.localeCompare(b.name))
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

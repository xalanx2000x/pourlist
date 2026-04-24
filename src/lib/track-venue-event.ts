import { supabase } from '@/lib/supabase'
import { getDeviceHash } from '@/lib/device'

export type VenueEventType = 'view' | 'hh_confirm' | 'photo_upload'

/**
 * Track a venue engagement event to Supabase for internal analytics.
 * Silently fails — analytics should never break the user-facing app.
 */
export async function trackVenueEvent(
  venueId: string,
  eventType: VenueEventType,
  location?: { lat: number; lng: number } | null
): Promise<void> {
  try {
    const { error } = await supabase.from('venue_events').insert({
      venue_id: venueId,
      event_type: eventType,
      device_hash: getDeviceHash(),
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
    })
    if (error) {
      // Log but don't throw — analytics are non-critical
      console.warn('[trackVenueEvent] insert failed:', error.message)
    }
  } catch (err) {
    // Swallow — never let analytics break the app
    console.warn('[trackVenueEvent] unexpected error:', err)
  }
}

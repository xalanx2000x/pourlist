/**
 * Tracks user interaction events to the analytics backend.
 * Used to understand how users move through the app,
 * what fails, and where to improve.
 *
 * Events are fire-and-forget — the API always returns 200
 * so failures never impact the user experience.
 */
export type EventName =
  | 'scan_start'          // user confirmed venue, entered review flow
  | 'scan_complete'       // user successfully saved menu/HH
  | 'scan_abandon'        // user gave up / closed without saving
  | 'hh_accepted'         // user saved HH without editing the parsed result
  | 'hh_edited'           // user modified parsed HH before saving
  | 'menu_capture'        // user took photos
  | 'menu_parse_success'  // GPT extracted text
  | 'menu_parse_failure'  // GPT failed to extract
  | 'menu_save_success'   // saved to DB
  | 'menu_save_failure'   // save failed
  | 'venue_view'          // user tapped a map pin or list row
  | 'venue_detail_open'   // detail panel opened
  | 'onboarding_complete' // user finished the tour
  | 'onboarding_skip'    // user skipped the tour

interface TrackEventOptions {
  deviceHash: string
  venueId?: string
  metadata?: Record<string, string | number | boolean | undefined>
}

export async function trackEvent(
  eventName: EventName,
  options: TrackEventOptions
): Promise<void> {
  try {
    await fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName, ...options })
    })
  } catch {
    // Silently ignore — never block UX for analytics
  }
}
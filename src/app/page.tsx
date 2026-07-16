'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { Venue } from '@/lib/supabase'
import { getVenuesInBounds, getVenuesByProximity, getVenueById, getVenueBySlugClient, isListed, type LeanVenue, type VenueBounds } from '@/lib/venues'
import { checkHappyHour } from '@/lib/happyHourCheck'
import { isWithinRadius, isWithinPresence } from '@/lib/gpsCheck'
import VenueList from '@/components/VenueList'
import VenueDetail from '@/components/VenueDetail'

import MenuCapture from '@/components/MenuCapture'
import VenuePicker from '@/components/VenuePicker'
import ScanStart from '@/components/ScanStart'
import NameEntry from '@/components/NameEntry'
import SupportScreen from '@/components/SupportScreen'
import OnboardingModal, { useOnboarding, useAppOpenCount } from '@/components/OnboardingModal'
import { trackEvent } from '@/lib/analytics'
import { getDeviceHash } from '@/lib/device'
import { trackVenueEvent } from '@/lib/track-venue-event'
import { checkRateLimit } from '@/lib/rateLimit'
import { getBrowserLocation, LocationUnavailableError } from '@/lib/gps'
import { parseHHSchedule } from '@/lib/parse-hh'
import { haversineM } from '@/lib/geo'
import { getHHState, resolveHH } from '@/lib/hh-state'
import { isDeepLinkActive, setDeepLinkFlag } from '@/lib/deep-link'
import SearchBar from '@/components/SearchBar'
import MenuReview from '@/components/MenuReview'
import SeedMatchConfirm from '@/components/SeedMatchConfirm'

const Map = dynamic(() => import('@/components/Map'), { ssr: false })

type ViewMode = 'map' | 'list'

// ── New scan step state machine ───────────────────────────────────────────
type ScanStep =
  | 'idle'
  | 'scan_start'    // ScanStart — location check + venue list + add venue option
  | 'capture'       // MenuCapture — taking 1–4 photos
  | 'venue_picker'  // VenuePicker — GPS available, confirm nearby venue
  | 'name_entry'   // NameEntry — type venue name, fuzzy match
  | 'review'       // MenuReview — HH time + photos, commit
  | 'seed_match'   // SeedMatchConfirm — seed venue detected nearby

type ScanState = {
  files: File[]
  phoneGps: { lat: number; lng: number; accuracy?: number; source?: 'gps' | 'ip' } | null   // phone's current GPS + accuracy + source (accuracy/source undefined if unavailable)
  confirmedVenue: Venue | null
  newVenueName: string | null
  menuText: string | null
  startedAt: number | null  // Date.now() when scan entered review step — used for funnel duration
  seedMatch: Venue | null   // seed venue detected within 100m — Job 5
  seedVenueForPromotion: Venue | null  // seed venue to promote via MenuReview → submit-venue with HH
}

function emptyScanState(): ScanState {
  return {
    files: [],
    phoneGps: null,
    confirmedVenue: null,
    newVenueName: null,
    menuText: null,
    startedAt: null,
    seedMatch: null,
    seedVenueForPromotion: null,
  }
}

export default function Home() {
  const [venues, setVenues] = useState<LeanVenue[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  // Fixed radius: enough to cover any plausible search area (≈50 miles).
  // The map bounds filter what is visible, but we load a wide area so
  // panning doesn't result in empty states after a manual reload.
  const DEFAULT_RADIUS_METERS = 50 * 1609.34
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)

  /**
   * True while a deep-linked venue (`?venue=…`) owns the map position.
   * Driven as STATE (not just a ref) because it must gate the
   * `showUserLocation` prop on Map — that prop's effect runs on mount
   * and calls navigator.geolocation.getCurrentPosition directly,
   * independent of page.tsx's GPS useEffect. While the prop is false,
   * the entire showUserLocation flow (including the watchPosition
   * call) is skipped. The ref is kept in sync for synchronous checks
   * inside async callbacks (where the stale closure can otherwise
   * read the wrong value).
   */
  const [deepLinkActive, setDeepLinkActive] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('venue')
  })
  const deepLinkActiveRef = useRef(deepLinkActive)
  useEffect(() => { deepLinkActiveRef.current = deepLinkActive }, [deepLinkActive])
  // Stash the deep-link slug on the very first render so the async
  // useEffect can pick it up after the URL is cleaned. The synchronous
  // bootstrap below writes to it on the first render; subsequent
  // renders leave it alone.
  const deepLinkSlugRef = useRef<string | null>(null)

  // === SYNCHRONOUS DEEP-LINK BOOTSTRAP =====================================
  // Runs on the first render, BEFORE any useEffect (including our own
  // deep-link useEffect, and Next.js's own history-management
  // useEffects that may call replaceState). Sets the module-level
  // flag, stashes the slug, and cleans the URL — in that exact order —
  // so isDeepLinkActive()'s URL fallback path never sees a stripped
  // ?venue= with a not-yet-set flag.
  //
  // This is the EARLIEST possible point at which the flag can be set
  // in the component tree. The previous attempt (setting it inside
  // the deep-link useEffect) lost the race on desktop: the
  // useEffect's body was gated on `if (!deepLinkActive) return` and
  // deepLinkActive was false on the first render (SSR default), so
  // the flag was never set, and the URL fallback saw a stripped
  // URL (Next.js's router ran after my useEffect and called
  // replaceState), and ipapi.co fired. This synchronous bootstrap
  // closes that race because it runs before ANY useEffect.
  if (typeof window !== 'undefined') {
    const _bootstrapParams = new URLSearchParams(window.location.search)
    const _bootstrapSlug = _bootstrapParams.get('venue')
    if (_bootstrapSlug) {
      // Order is critical: flag first, then URL cleanup. If we
      // cleaned the URL first, the URL fallback in isDeepLinkActive()
      // would return false for one synchronous tick before the flag
      // gets set — and a tick is enough for the GPS useEffect to
      // slip through.
      setDeepLinkFlag(true)
      deepLinkActiveRef.current = true
      deepLinkSlugRef.current = _bootstrapSlug
      // Now safe to clean the URL. The flag is already set so any
      // subsequent isDeepLinkActive() call (even via the URL
      // fallback) returns true.
      window.history.replaceState({}, '', window.location.pathname)
    }
  }
  // === /SYNCHRONOUS DEEP-LINK BOOTSTRAP =====================================
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null)
  // listBounds mirrors mapBounds — keeps list in sync when switching views
  const [listBounds, setListBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null)
  const [areaName, setAreaName] = useState<string | null>(null)
  const [zoomToUserTick, setZoomToUserTick] = useState(0)
  const [flyToCenter, setFlyToCenter] = useState<{ lat: number; lng: number } | null>(null)
  const flyToCenterRef = useRef<{ lat: number; lng: number } | null>(null)
  const showOnboarding = useOnboarding()
  const appOpenCount = useAppOpenCount()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [searchedLocation, setSearchedLocation] = useState<{ lat: number; lng: number } | null>(null)
  // "Search this area" button shown when user has panned far from last venue load
  const [showSearchThisArea, setShowSearchThisArea] = useState(false)
  // Function provided by <Map> to read current map center on demand
  const [getMapCenter, setGetMapCenter] = useState<(() => { lat: number; lng: number } | undefined) | null>(null)
  const originalGpsLocation = { lat: 45.523, lng: -122.676 }
  // True when getVenuesInBounds hit the 150-row cap — i.e. there are
  // more venues in the viewport that didn't make the cut. Surfaced
  // as a "showing top N — zoom in" hint in the list header.
  const [capped, setCapped] = useState(false)

  // Show onboarding automatically on first eligible visit only
  useEffect(() => {
    if (showOnboarding) setOnboardingOpen(true)
  }, [showOnboarding])

  // ── Scan workflow state ──────────────────────────────────────────────────
  const [scanStep, setScanStep] = useState<ScanStep>('idle')
  const [scan, setScan] = useState<ScanState>(emptyScanState())
  const [saveSuccess, setSaveSuccess] = useState(false)
  // Per-scan-session dedup for hh_blocked_input: prevents logging the same failed
  // text twice if user types it again after a successful commit within the session.
  // Lives at page.tsx level (above scanStep) so it survives MenuReview remounts.
  const lastLoggedFailedText = useRef<string>('')
  // Friendly hint when location is genuinely unavailable (OS off,
  // browser denied, IP lookup failed). One per session — ref-guarded
  // so retries don't re-nag. The deep-link chokepoint rejection is
  // NOT a LocationUnavailableError, so it won't trigger this.
  const [locationToast, setLocationToast] = useState(false)
  const locationToastShownRef = useRef(false)
  const showLocationToastOnce = useCallback(() => {
    if (locationToastShownRef.current) return
    locationToastShownRef.current = true
    setLocationToast(true)
  }, [])
  useEffect(() => {
    if (!locationToast) return
    const t = setTimeout(() => setLocationToast(false), 8000)
    return () => clearTimeout(t)
  }, [locationToast])
  const [lastSavedVenue, setLastSavedVenue] = useState<string | null>(null)
  const [gpsWarning, setGpsWarning] = useState<string | null>(null)

  const loadVenues = useCallback(async (bounds: VenueBounds): Promise<LeanVenue[]> => {
    try {
      const { venues: data, capped: wasCapped } = await getVenuesInBounds(
        bounds.north,
        bounds.south,
        bounds.east,
        bounds.west
      )
      setVenues(data)
      setCapped(wasCapped)
      // The bounds filter (visibleVenues below) uses mapBounds as the
      // source of truth. We don't need to reset it here — the caller
      // (the mapBounds useEffect) just set the bounds that drove this
      // fetch, so the filter is already in sync.
      return data
    } catch (err) {
      console.error('Failed to load venues:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // Deep-link resolver: /?venue={slug} from a shared venue page.
  // The synchronous bootstrap above (in the function body) has
  // already:
  //   - set the module-level flag
  //   - stashed the slug in deepLinkSlugRef
  //   - cleaned the URL
  //   - scheduled a setDeepLinkActive(true) re-render
  // This useEffect just runs the async fetch and drives the rest of
  // the deep-link UX (loadVenues, setSelectedVenue, error paths).
  // The slug is read from the ref because the URL has been cleaned.
  useEffect(() => {
    if (!deepLinkActive) return
    const slug = deepLinkSlugRef.current
    if (!slug) return

    ;(async () => {
      try {
        const venue = await getVenueBySlugClient(slug)
        if (!venue || venue.lat == null || venue.lng == null) {
          deepLinkActiveRef.current = false
          setDeepLinkFlag(false)
          setDeepLinkActive(false)
          return
        }
        if (!deepLinkActiveRef.current) return
        // Approximate bounds at zoom 16 for the immediate fetch so
        // the list fills in without waiting for the map's flyTo.
        // The mapBounds useEffect (gated on `!deepLinkActive`) won't
        // fire here, so this is the only fetch in the deep-link path.
        const latDelta = 0.003
        const lngDelta = 0.003 / Math.cos(venue.lat * Math.PI / 180)
        await loadVenues({
          north: venue.lat + latDelta,
          south: venue.lat - latDelta,
          east: venue.lng + lngDelta,
          west: venue.lng - lngDelta
        })
        if (!deepLinkActiveRef.current) return
        setSelectedVenue(venue)
      } catch {
        deepLinkActiveRef.current = false
        setDeepLinkFlag(false)
        setDeepLinkActive(false)
      }
    })()
    return () => {
      setDeepLinkFlag(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkActive])

  // Load venues whenever user location becomes available
  // Gated on isDeepLinkActive (synchronous URL/module check) and on
  // deepLinkActive (React state). The URL check is the primary fix
  // for the first render before state has propagated; the state
  // check catches subsequent re-runs. Belt and suspenders.
  // Map-bounds-driven fetch with userLocation + default fallbacks.
  // The trigger is "we have *some* bounds" — most accurate wins:
  //
  //   1. mapBounds (set on map load + on every moveend) — most
  //      accurate, but the map only mounts after `loading` clears,
  //      which is after this fetch completes. So this refines once
  //      the map is visible.
  //   2. userLocation (GPS / IP / default fallback from the chain
  //      below) — available immediately after the GPS chain settles
  //      (~1s for GPS, ~50ms for IP, immediate on no-GPS default).
  //   3. Portland default (originalGpsLocation) — last-resort
  //      bootstrap before the GPS chain has even started. Ensures
  //      the user always sees something instead of a perpetual
  //      "Loading venues..." spinner.
  //
  // Note: the deep-link useEffect below calls loadVenues directly
  // with bounds, so the deep-link case is not gated here.
  useEffect(() => {
    if (isDeepLinkActive()) return
    if (deepLinkActive) return

    // Approximate bounds at zoom 13 (the "Search this area" zoom).
    // For the user's exact viewport, the mapBounds-driven refinement
    // below produces a more accurate fetch.
    const computeBounds = (lat: number, lng: number): VenueBounds => {
      // 500m radius — genuinely local, not half the city
      const latDelta = 0.0045
      const lngDelta = latDelta / Math.cos(lat * Math.PI / 180)
      return {
        north: lat + latDelta,
        south: lat - latDelta,
        east: lng + lngDelta,
        west: lng - lngDelta
      }
    }

    // Intentionally NO venue fetch on mount. Firing one here (before GPS
    // resolves) used the Portland default center and could RACE the GPS
    // fetch — if the default fetch's response landed after the GPS fetch,
    // last-write-wins put the wrong (Portland) venues on the map. Instead
    // we wait: the GPS effect sets userLocation (real location on success,
    // fallback on failure/timeout) which triggers this effect with the
    // correct center. Do not add an initial fetch here.
    if (!mapBounds && !userLocation) return

    const bounds = mapBounds
      ?? computeBounds(userLocation!.lat, userLocation!.lng)

    loadVenues(bounds)
  }, [mapBounds, userLocation, deepLinkActive, loadVenues])

  // Get user location on mount.
  // Three layers of defense:
  //   1. isDeepLinkActive() — synchronous URL/module check, catches
  //      the first render before state has propagated, AND is the
  //      chokepoint that getBrowserLocation() also reads (so even if
  //      this useEffect slips through, the function call itself
  //      rejects when a deep link is active).
  //   2. deepLinkActive (React state) — catches subsequent re-runs.
  //   3. getBrowserLocation()'s own isDeepLinkActive() check inside
  //      the function body (lib/gps.ts) — the chokepoint itself.
  //
  // On failure: fall back to the Portland default so the no-GPS,
  // no-IP user still sees the app's home area. The mapBounds
  // useEffect will then load Portland venues via the initial map
  // bounds.
  //
  // HARD OUTER TIMEOUT (5s): getBrowserLocation() has an internal 10s GPS
  // timeout + IP fallback, but a user-ignored permission prompt or a slow
  // GPS fix can hang indefinitely. Race with a 5s timeout so ANY rejection
  // (GPS denied, IP failed, timeout, ignored prompt) falls back to
  // originalGpsLocation and triggers the venue fetch — guaranteeing the
  // map is never left empty.
  useEffect(() => {
    if (isDeepLinkActive()) return
    if (deepLinkActive) return
    Promise.race([
      getBrowserLocation(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new LocationUnavailableError('GPS timeout')), 5_000)
      )
    ])
      .then(loc => setUserLocation(loc))
      .catch((err) => {
        showLocationToastOnce()
        setUserLocation(originalGpsLocation)
      })
  }, [deepLinkActive, showLocationToastOnce])

  // User-initiated map move (drag, pinch, scroll-zoom, etc.). Clears
  // the deep-link state and fetches GPS for future use — but does NOT
  // recenter the map (the user is panning, the map is where they want
  // it). They can tap "Search this area" or "near me" to act on GPS.
  // Clears BOTH the React state and the module-level flag so the
  // chokepoint in getBrowserLocation lets the call through AND the
  // Map's showUserLocation prop flips to true.
  const handleUserPan = useCallback(() => {
    if (!deepLinkActive) return
    deepLinkActiveRef.current = false
    setDeepLinkFlag(false)
    setDeepLinkActive(false)
    getBrowserLocation()
      .then(loc => setUserLocation(loc))
      .catch((err) => {
        if (err instanceof LocationUnavailableError) showLocationToastOnce()
      })
  }, [deepLinkActive, showLocationToastOnce])

  // Reverse-geocode user location to get a human-readable area name
  useEffect(() => {
    if (!userLocation) return
    const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''
    if (!MAPBOX_TOKEN) return

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${userLocation.lng},${userLocation.lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=neighborhood,locality,place`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const feat = data.features?.[0]
        if (feat?.text) {
          setAreaName(feat.text)
        }
      })
      .catch(() => {})
  }, [userLocation])


  function handleSearchClear() {
    setSearchedLocation(originalGpsLocation)
    setUserLocation(originalGpsLocation)
    setMapBounds(null)
    setListBounds(null)
  }

  function handleSearch(coords: { lat: number; lng: number }, meta?: {
    query: string
    queryType: 'venue' | 'location'
    resultCount: number
    resultVenueIds: string[]
    searchArea: string
  }) {
    setSearchedLocation(coords)
    setUserLocation(coords)
    setMapBounds(null)
    setListBounds(null)
    setShowSearchThisArea(false)

    // Trigger immediate fetch with approximate bounds at zoom 13
    // (the default for the search-bar flyTo). The map will fly in
    // parallel; a second fetch fires via the mapBounds useEffect
    // when the flyTo completes with the exact bounds. The second
    // fetch is a no-op or minor refinement.
    const latDelta = 0.0045
    const lngDelta = latDelta / Math.cos(coords.lat * Math.PI / 180)
    loadVenues({
      north: coords.lat + latDelta,
      south: coords.lat - latDelta,
      east: coords.lng + lngDelta,
      west: coords.lng - lngDelta
    })
  }

  // User moved the map — show the "Search this area" button so they can
  // reload venues from the new map center.
  function handleMapMove() {
    setMapBounds(null)
    setListBounds(null)
    setShowSearchThisArea(true)
  }

  // "Search this area" button — fly to center and immediately load venues from it.
  function handleSearchHereClick() {
    setShowSearchThisArea(false)
    const center = getMapCenter?.()
    if (center) {
      setSearchedLocation(center)
      setFlyToCenter(center)
      // Approximate bounds at zoom 13 for the immediate fetch; the
      // mapBounds useEffect will refine when the flyTo completes.
      const latDelta = 0.0045
      const lngDelta = latDelta / Math.cos(center.lat * Math.PI / 180)
      loadVenues({
        north: center.lat + latDelta,
        south: center.lat - latDelta,
        east: center.lng + lngDelta,
        west: center.lng - lngDelta
      })
    }
  }

  // My Location button — flies to user location. User then taps "Search this area"
  // to reload venues from their actual position.
  // In deep-link mode: clear the React state AND the module-level flag,
  // fetch GPS (no prompt if previously granted), then zoom to the
  // resolved coords. We chain the zoom onto the GPS resolve so
  // the first tap in deep-link mode does the right thing in one motion.
  // The React state must be reset too — the Map's showUserLocation prop
  // is gated on `!deepLinkActive`, so leaving the state true would keep
  // the user dot suppressed after the GPS fix resolves.
  function handleZoomToUser() {
    if (deepLinkActive) {
      deepLinkActiveRef.current = false
      setDeepLinkFlag(false)
      setDeepLinkActive(false)
      getBrowserLocation()
        .then(loc => {
          setUserLocation(loc)
          setZoomToUserTick(t => t + 1)
          setShowSearchThisArea(true)
          // Fire search from the user's actual location (getMapCenter won't
          // reflect the fly-to target until after the animation completes).
          const userCenter = { lat: loc.lat, lng: loc.lng }
          const latDelta = 0.0045
          const lngDelta = latDelta / Math.cos(loc.lat * Math.PI / 180)
          setSearchedLocation(userCenter)
          setFlyToCenter(userCenter)
          loadVenues({
            north: loc.lat + latDelta,
            south: loc.lat - latDelta,
            east: loc.lng + lngDelta,
            west: loc.lng - lngDelta,
          })
        })
        .catch((err) => {
          if (err instanceof LocationUnavailableError) showLocationToastOnce()
        })
      return
    }
    if (!userLocation) return
    setZoomToUserTick(t => t + 1)
    setShowSearchThisArea(true)
    // Non-deep-link: search from current userLocation
    const latDelta = 0.0045
    const lngDelta = latDelta / Math.cos(userLocation.lat * Math.PI / 180)
    const userCenter = { lat: userLocation.lat, lng: userLocation.lng }
    setSearchedLocation(userCenter)
    setFlyToCenter(userCenter)
    loadVenues({
      north: userLocation.lat + latDelta,
      south: userLocation.lat - latDelta,
      east: userLocation.lng + lngDelta,
      west: userLocation.lng - lngDelta,
    })
  }

  async function handleVenueSelect(venue: LeanVenue) {
    trackEvent('venue_view', { deviceHash: getDeviceHash(), venueId: venue.id })
    trackVenueEvent(venue.id, 'view', userLocation)

    // Always re-fetch from DB by ID — ensures the detail page has fresh
    // HH and all other fields. If the fetch fails, leave the previous
    // selectedVenue alone rather than setting a partial (lean) venue
    // on the detail view.
    const freshVenue = await getVenueById(venue.id)
    if (freshVenue) setSelectedVenue(freshVenue)

    // Reload the list with bounds around the clicked venue so it
    // appears in the viewport. Approximate bounds at zoom 16 (the
    // "selected venue" flyTo zoom) — the map's moveend will refine
    // with the exact bounds via the mapBounds useEffect.
    const finalVenue = freshVenue ?? venue
    if (finalVenue.lat != null && finalVenue.lng != null) {
      const latDelta = 0.003
      const lngDelta = 0.003 / Math.cos(finalVenue.lat * Math.PI / 180)
      loadVenues({
        north: finalVenue.lat + latDelta,
        south: finalVenue.lat - latDelta,
        east: finalVenue.lng + lngDelta,
        west: finalVenue.lng - lngDelta
      })
    }
  }

  // ── Scan workflow handlers ───────────────────────────────────────────────

  /**
   * Step 0: User tapped "Scan Menu" → open ScanStart (location + venue list).
   */
  function handleScanStartVenueSelected(venue: Venue) {
    // Save selected venue, proceed to photo capture
    setScan(prev => ({ ...emptyScanState(), confirmedVenue: venue }))
    setScanStep('capture')
  }

  /**
   * Step 0b: User tapped "Add Happy Hour Location" → proceed to capture
   * for a new venue (no pre-selected venue).
   */
  function handleScanStartAddVenue() {
    setScan(emptyScanState())
    setScanStep('capture')
  }

  /**
   * Step 1: Photos captured → decide next step based on GPS + pre-selected venue.
   *
   * If a venue was pre-selected in scan_start:
   *   - GPS available → verify within 15m → proceed to review
   *   - No GPS → name_entry (confirm or create venue)
   *
   * If no venue pre-selected (user tapped "Add Venue"):
   *   - GPS available → venue_picker (show nearby venues to snap to)
   *   - No GPS → name_entry
   */
  /**
   * Parse menu photos in parallel using the AI parse-menu endpoint.
   * Accumulates all extracted text into one string.
   * Silently fails — MenuReview falls back to manual HH entry on error.
   */
  /**
   * Log a parse failure to the events table for dashboard analysis.
   * Fire-and-forget — never blocks UX.
   *
   * failureType:
   *   'hh_blocked_input' — user typed HH text the parser couldn't interpret (block point = submission)
   *   'gpt_image'         — GPT failed to read menu photo (parked feature; kept for future use)
   */
  async function logParseFailure(opts: {
    failureType: string
    rawText: string
    error?: string
    metadata?: Record<string, unknown>
  }) {
    try {
      await fetch('/api/log-parse-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceHash: getDeviceHash(),
          failureType: opts.failureType,
          rawText: opts.rawText,
          error: opts.error,
          metadata: opts.metadata ?? null,
        }),
      })
    } catch {
      // Silently ignore — analytics must never break UX
    }
  }

  /**
   * Extract the specific failing clauses from a multi-clause HH input string.
   * Splits on comma/semicolon the same way parseHHSchedule does, then identifies
   * which clauses returned null. Used to log only the actionable failing text.
   */
  function getFailingClauses(text: string): string[] {
    const clauses = text.split(/[,;]/).map(s => s.trim()).filter(Boolean)
    if (clauses.length <= 1) return []  // single-clause: whole text is the failure
    return clauses.filter(clause => {
      try { return parseHHSchedule(clause).totalParsed === 0 }  // eslint-disable-line @typescript-eslint/no-unused-expressions
      catch { return true }
    })
  }

  /**
   * Log a blocked HH submission: distinct failed input per scan session.
   * Also extracts the specific failing clause(s) for actionable logging.
   */
  function handleHhParseFailureAttempt(rawText: string) {
    if (rawText !== lastLoggedFailedText.current) {
      lastLoggedFailedText.current = rawText
      const failingClauses = getFailingClauses(rawText)
      logParseFailure({
        failureType: 'hh_blocked_input',
        rawText,
        metadata: failingClauses.length > 0 ? { failingClauses } : undefined,
      })
    }
  }

  async function parseMenuPhotos(files: File[]): Promise<string> {
    if (files.length === 0) return ''
    const deviceHash = getDeviceHash()
    let hadApiError = false
    let apiErrorMsg = ''

    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const base64 = await fileToBase64NoResize(file)
          const res = await fetch('/api/parse-menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: base64,
              deviceHash,
            })
          })
          if (!res.ok) {
            hadApiError = true
            apiErrorMsg = `HTTP ${res.status}`
            return ''
          }
          const { text } = await res.json()
          return text ?? ''
        })
      )
      const combined = results.filter(Boolean).join('\n---\n')

      if (combined) {
        // At least one page produced text
        trackEvent('menu_parse_success', { deviceHash, metadata: { pageCount: files.length } })
      }
      // GPT image feature is parked — parse_failure events not written for image failures.
      // The analytics trackEvent above still fires for funnel analysis.
      return combined
    } catch {
      return ''
    }
  }

  /**
   * Convert a File to a base64 data URL without resizing.
   */
  async function fileToBase64NoResize(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleCapture(files: File[], phoneGps: { lat: number; lng: number; accuracy?: number; source?: 'gps' | 'ip' }) {
    const confirmedVenue = scan.confirmedVenue

    // Parse menu photos immediately so text is ready for MenuReview
    const menuText = await parseMenuPhotos(files)

    if (confirmedVenue) {
      // Existing venue path — HARD BLOCK if user is not within presence radius.
      // No GPS = cannot verify presence = blocked.
      if (!phoneGps) {
        setGpsWarning('PourList needs your location to confirm you\'re at the venue. Please enable location and try again.')
        return
      }
      if (phoneGps.source === 'ip') {
        setGpsWarning('Your precise location isn\'t available. Please enable GPS/Location Services (not just network location) and try again from the venue.')
        return
      }
      if (confirmedVenue.lat != null && confirmedVenue.lng != null) {
        const withinRange = isWithinPresence(
          phoneGps.lat, phoneGps.lng,
          confirmedVenue.lat, confirmedVenue.lng,
          phoneGps.accuracy
        )
        if (!withinRange) {
          setGpsWarning('It appears you are not at the venue. Please get closer to the venue to submit a happy hour menu.')
          return
        }
      }
      setScan(prev => ({ ...prev, files, phoneGps, menuText }))
      await transitionToReview(confirmedVenue, null)
      return
    }

    // No venue pre-selected: phone GPS is the sole location source.
    const venueProposedCoords = phoneGps
    setScan(prev => ({ ...prev, files, phoneGps, menuText }))

    // ── Job 5: Seed venue proximity check ────────────────────────────────
    // Before showing the venue_picker, check if there's a seed venue within 100m.
    // If found, show "Did you mean this venue?" instead of the normal venue_picker.
    if (venueProposedCoords != null) {
      try {
        const seedVenues = await getVenuesByProximity(venueProposedCoords.lat, venueProposedCoords.lng, 150)
          .then(venues => venues.filter(v => v.is_seed_data === true))
        if (seedVenues.length > 0) {
          // Pick the closest seed venue by GPS distance
          const best = seedVenues.sort((a, b) => {
            if (a.lat == null || a.lng == null) return 1
            if (b.lat == null || b.lng == null) return -1
            const da = haversineM(venueProposedCoords.lat, venueProposedCoords.lng, a.lat, a.lng)
            const db = haversineM(venueProposedCoords.lat, venueProposedCoords.lng, b.lat, b.lng)
            return da - db
          })[0]
          if (best) {
            setScan(prev => ({ ...prev, seedMatch: best }))
            setScanStep('seed_match')
            return
          }
        }
      } catch {
        // Proceed to venue_picker on error
      }
    }

    if (venueProposedCoords != null) {
      setScanStep('venue_picker')
    } else {
      setScanStep('name_entry')
    }
  }

  /**
   * Step 2a: Venue confirmed from VenuePicker → proceed to review directly.
   */
  async function handleVenueConfirmed(venue: Venue) {
    setScan(prev => ({ ...prev, confirmedVenue: venue }))
    await transitionToReview(venue, null)
  }

  /**
   * Step 2b: No nearby venue from VenuePicker, or "No, I'm not here" → go to name entry.
   */
  function handleVenueNotListed() {
    setScanStep('name_entry')
  }

  /**
   * Step 3a: Matched an existing venue from NameEntry fuzzy search.
   */
  async function handleVenueMatched(venue: Venue) {
    setScan(prev => ({ ...prev, confirmedVenue: venue }))
    await transitionToReview(venue, null)
  }

  /**
   * Step 3b: User wants to create a new venue from NameEntry.
   */
  async function handleVenueCreated(name: string) {
    setScan(prev => ({ ...prev, newVenueName: name }))
    await transitionToReview(null, name)
  }

  /**
   * Job 6: User confirmed the seed venue match.
   * Promotes seed → live, inserts photos, clears flags.
   */
  async function handleSeedMatchConfirm(seedVenue: Venue) {
    // ── Route seed confirmation through MenuReview to collect HH ─────────────
    // Rule (b): every submission requires photo AND HH. Seed promotion must go
    // through MenuReview like new-venue and existing-venue paths do.
    setScan(prev => ({
      ...prev,
      seedVenueForPromotion: seedVenue,
      newVenueName: seedVenue.name,
      confirmedVenue: null,
      startedAt: Date.now(),
    }))
    setScanStep('review')

    await trackEvent('scan_start', {
      deviceHash: getDeviceHash(),
      venueId: seedVenue.id,
      metadata: {
        isNewVenue: false,
        isSeedPromotion: true,
        photoCount: scan.files.length,
        hasPhoneGps: !!scan.phoneGps,
      },
    })
  }

  /**
   * Job 6: User denied the seed venue match — proceed to name_entry.
   */
  function handleSeedMatchDeny() {
    // A denied seed must NOT be graduated with new data the user explicitly rejected.
    // Clear seedVenueForPromotion so the deny path cannot accidentally promote a
    // rejected seed — the user chose to create a new venue or none.
    setScan(prev => ({ ...prev, seedMatch: null, seedVenueForPromotion: null }))
    setScanStep('name_entry')
  }

  /**
   * Parse all photos in parallel, then show MenuReview.
   */
  /**
   * Transition to review: no more parsing. Just capture photos and go to review.
   */
  async function transitionToReview(venue: Venue | null, newVenueName: string | null) {
    setScan(prev => ({
      ...prev,
      confirmedVenue: venue,
      newVenueName: newVenueName ?? prev.newVenueName,
      startedAt: Date.now(),
    }))
    setScanStep('review')

    // Track scan funnel start
    await trackEvent('scan_start', {
      deviceHash: getDeviceHash(),
      venueId: venue?.id,
      metadata: {
        isNewVenue: !!newVenueName,
        photoCount: scan.files.length,
        hasPhoneGps: !!scan.phoneGps,
      },
    })
  }

  /**
   * Shared save core — routes to the correct API endpoint based on venue state.
   *
   * Invisible 3-way branch:
   *   - existing user venue  → POST /api/commit-menu  (HH update + photo insert)
   *   - new venue            → POST /api/submit-venue (INSERT + geocode + slug + photo insert)
   *   - OSM/seed graduation  → POST /api/submit-venue with seedVenueId
   *                            (UPDATE is_seed_data=false + geocode from seed coords + slug + HH + photo insert)
   *
   * Seed-coords rule: for OSM graduation, geocode uses the seed's stored lat/lng
   * (precise OSM coordinates). Phone GPS is used ONLY for the presence check,
   * NEVER to repin the venue.
   *
   * Photo format: all branches use compressed base64 (max 1.5MB JPEG) for upload.
   * Both API routes accept base64 data URLs — this standardizes the format with no regression.
   */
  /** Lazy-loads fileToBase64 chunk. Wraps chunk-load failure so MenuReview's
   *  neutral error handler can catch it and show the correct user message. */
  async function loadFileToBase64() {
    try {
      return await import('@/lib/fileToBase64')
    } catch {
      throw new Error('chunk_load_failed')
    }
  }

  async function saveSubmissionCore(opts: {
    existingVenue:         Venue | null
    newVenueName:           string | null
    seedVenueForPromotion:  Venue | null
    files:                  File[]
    phoneGps:               { lat: number; lng: number; accuracy?: number; source?: 'gps' | 'ip' } | null
    hhWindows:              [import('@/lib/parse-hh').HHWindow | null, import('@/lib/parse-hh').HHWindow | null, import('@/lib/parse-hh').HHWindow | null]
    hhSummary:              string
    deviceHash:             string
  }): Promise<{ venueId: string; venueName: string }> {
    const { existingVenue, newVenueName, seedVenueForPromotion, files, phoneGps, hhWindows, hhSummary, deviceHash } = opts

    // ── GPS gate — real GPS required for all submissions ────────────────────────
    if (!phoneGps) {
      throw new Error('No location found. Please take the photo at the venue.')
    }
    if (phoneGps.source === 'ip') {
      throw new Error('Your precise location isn\'t available. Please enable GPS/Location Services (not just network location) and try again from the venue.')
    }

    // ── Presence check — existing and OSM venues only (new has no venue coords) ─
    const hasVenueCoords = (v: Venue) => v.lat != null && v.lng != null
    const presenceTarget = existingVenue ?? seedVenueForPromotion
    if (presenceTarget && hasVenueCoords(presenceTarget)) {
      const withinRange = isWithinPresence(
        phoneGps.lat, phoneGps.lng,
        presenceTarget.lat!, presenceTarget.lng!,
        phoneGps.accuracy
      )
      if (!withinRange) {
        throw new Error('It appears you are not at the venue. Please get closer to the venue to submit a happy hour menu.')
      }
    }

    // ── Build HH window FormData helpers ──────────────────────────────────────
    function appendHhWindows(fd: FormData) {
      const w1 = hhWindows[0]; const w2 = hhWindows[1]; const w3 = hhWindows[2]
      function ap(w: import('@/lib/parse-hh').HHWindow, prefix: string, daysKey: string, exclKey: string) {
        if (!w.type) return
        fd.append(prefix, w.type)
        fd.append(daysKey, String(w.days.join(',')))
        fd.append(prefix.replace('type', 'start'), w.startMin != null ? String(w.startMin) : '')
        fd.append(prefix.replace('type', 'end'), w.endMin != null ? String(w.endMin) : '')
        if (w.excludeDays?.length) fd.append(exclKey, String(w.excludeDays.join(',')))
      }
      if (w1?.type) ap(w1, 'hh_type', 'hh_days', 'hh_exclude_days')
      if (w2?.type) ap(w2, 'hh_type_2', 'hh_days_2', 'hh_exclude_days_2')
      if (w3?.type) ap(w3, 'hh_type_3', 'hh_days_3', 'hh_exclude_days_3')
      if (hhSummary) fd.append('hhSummary', hhSummary)
    }

    // ── Routing — centralized, venue-state-driven ────────────────────────────────
    //
    // Precedence (each branch uses `else if`, only one fires):
    //
    //  1. seedVenueForPromotion  — explicit seed CONFIRM from seed_match UI.
    //     The user consciously chose to promote this specific OSM seed.
    //     Post-deny-clear: this and newVenueName are mutually exclusive.
    //
    //  2. existingVenue?.is_seed_data === true  — an OSM seed reached via
    //     confirmedVenue (map pin, ScanStart list, venue_picker).
    //     Graduation is determined by the venue's state, not the entry point.
    //
    //  3. existingVenue  — confirmed user-created venue → HH update path.
    //
    //  4. newVenueName  — user typed a name with no confirmed venue.
    //     submit-venue runs name+proximity dedup against all venues (incl. seeds).

    // console.log: which branch fired —观察 deployed behavior
    // console.log: which branch fired + is_seed_data diagnostics
    console.log('[saveSubmissionCore] routing branch:', {
      has_seedVenueForPromotion: !!seedVenueForPromotion,
      has_existingVenue: !!existingVenue,
      existingIsSeed: existingVenue?.is_seed_data === true,
      has_newVenueName: !!newVenueName,
      // THE key diagnostic — suspected string 'true' or undefined:
      existingVenue_is_seed_data: existingVenue?.is_seed_data,
      existingVenue_is_seed_data_typeof: typeof existingVenue?.is_seed_data,
    })

    if (seedVenueForPromotion) {
      // ── 1. Explicit seed promotion (seed_match CONFIRM) ────────────────────
      const fd = new FormData()
      fd.append('seedVenueId', seedVenueForPromotion.id)
      fd.append('phoneLat', String(phoneGps.lat))
      fd.append('phoneLng', String(phoneGps.lng))
      fd.append('phoneAccuracy', String(phoneGps.accuracy ?? ''))
      fd.append('phoneSource', phoneGps.source ?? 'gps')
      fd.append('deviceHash', deviceHash)
      appendHhWindows(fd)
      const { fileToBase64 } = await loadFileToBase64()
      for (const file of files) {
        const base64 = await fileToBase64(file, 1.5)
        fd.append('photos', base64)
      }
      const res = await fetch('/api/submit-venue', { method: 'POST', body: fd })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || !result.success) {
        throw new Error(result.reason === 'photo_upload_failed'
          ? 'Photo upload didn\'t go through — nothing was saved. Please try again.'
          : result.error || 'Failed to verify venue. Please try again.')
      }
      return { venueId: result.venueId, venueName: seedVenueForPromotion.name }
    }

    if (existingVenue?.is_seed_data === true) {
      // ── 2. OSM seed reached via confirmedVenue — graduate it ────────────────
      // Any entry that sets confirmedVenue to an OSM seed (map pin, list pick,
      // venue_picker) ends up here. The routing decision is made from the
      // venue's state, not the entry point — so all entry paths that reach a
      // seed via confirmedVenue correctly graduate it.
      const fd = new FormData()
      fd.append('seedVenueId', existingVenue.id)
      fd.append('phoneLat', String(phoneGps.lat))
      fd.append('phoneLng', String(phoneGps.lng))
      fd.append('phoneAccuracy', String(phoneGps.accuracy ?? ''))
      fd.append('phoneSource', phoneGps.source ?? 'gps')
      fd.append('deviceHash', deviceHash)
      appendHhWindows(fd)
      const { fileToBase64 } = await loadFileToBase64()
      for (const file of files) {
        const base64 = await fileToBase64(file, 1.5)
        fd.append('photos', base64)
      }
      const res = await fetch('/api/submit-venue', { method: 'POST', body: fd })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || !result.success) {
        throw new Error(result.reason === 'photo_upload_failed'
          ? 'Photo upload didn\'t go through — nothing was saved. Please try again.'
          : result.error || 'Failed to verify venue. Please try again.')
      }
      return { venueId: result.venueId, venueName: existingVenue.name }
    }

    if (existingVenue) {
      // ── 3. Confirmed user-created venue — HH update ─────────────────────────
      const fd = new FormData()
      fd.append('venueId', existingVenue.id)
      fd.append('lat', String(phoneGps.lat))
      fd.append('lng', String(phoneGps.lng))
      fd.append('phoneAccuracy', String(phoneGps.accuracy ?? ''))
      fd.append('phoneSource', phoneGps.source ?? 'gps')
      fd.append('deviceHash', deviceHash)
      appendHhWindows(fd)
      const { fileToBase64 } = await loadFileToBase64()
      for (const file of files) {
        const base64 = await fileToBase64(file, 1.5)
        fd.append('photos', base64)
      }
      const res = await fetch('/api/commit-menu', { method: 'POST', body: fd })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || !result.success) {
        if (result.reason === 'invalid_timeframe') {
          throw new Error('Invalid timeframe — please check the start and end times.')
        }
        throw new Error(result.reason === 'photo_upload_failed'
          ? 'Photo upload didn\'t go through — nothing was saved. Please try again.'
          : result.error || 'Failed to save. Please try again.')
      }
      return { venueId: result.venueId, venueName: existingVenue.name }
    }

    if (newVenueName) {
      // ── 4. New venue — submit-venue runs name+proximity dedup ───────────────
      const fd = new FormData()
      fd.append('venueName', newVenueName)
      fd.append('phoneLat', String(phoneGps.lat))
      fd.append('phoneLng', String(phoneGps.lng))
      fd.append('phoneAccuracy', String(phoneGps.accuracy ?? ''))
      fd.append('phoneSource', phoneGps.source ?? 'gps')
      fd.append('deviceHash', deviceHash)
      appendHhWindows(fd)
      const { fileToBase64 } = await loadFileToBase64()
      for (const file of files) {
        const base64 = await fileToBase64(file, 1.5)
        fd.append('photos', base64)
      }
      const res = await fetch('/api/submit-venue', { method: 'POST', body: fd })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || !result.success) {
        if (result.reason === 'duplicate' && result.existingVenue) {
          throw new Error(`"${newVenueName}" already exists nearby as "${result.existingVenue.name}". Want to update that instead?`)
        }
        if (result.reason === 'invalid_timeframe') {
    throw new Error('Invalid timeframe — please check the start and end times.')
  }
  throw new Error(result.reason === 'photo_upload_failed'
    ? 'Photo upload didn\'t go through — nothing was saved. Please try again.'
    : result.error || 'Failed to create venue. Please try again.')
      }
      return { venueId: result.venueId, venueName: newVenueName }
    }

    throw new Error('No venue selected and no new venue name. Please start over.')
  }

  /**
   * Commit the menu: rate-limit check + call shared save core + post-save reload/analytics/toast.
   */
  async function handleMenuCommit(data: {
    hhWindows: [import('@/lib/parse-hh').HHWindow | null, import('@/lib/parse-hh').HHWindow | null, import('@/lib/parse-hh').HHWindow | null]
    hhTime: string
    hhSummary: string
    failedHhInput?: string | null
  }) {
    const { hhWindows, hhSummary, failedHhInput } = data
    const deviceHash = getDeviceHash()
    const limit = checkRateLimit(deviceHash)
    if (!limit.allowed) {
      const s = Math.ceil((limit.retryAfterMs || 0) / 1000)
      throw new Error(`Slow down! Please wait ${s}s before submitting again.`)
    }

    const { confirmedVenue, newVenueName, files, phoneGps, menuText, startedAt, seedVenueForPromotion } = scan

    const { venueId: savedVenueId, venueName } = await saveSubmissionCore({
      existingVenue:        confirmedVenue,
      newVenueName:          newVenueName,
      seedVenueForPromotion: seedVenueForPromotion,
      files,
      phoneGps,
      hhWindows,
      hhSummary,
      deviceHash,
    })

    // ── Post-save: reload venue + map ──────────────────────────────────────────
    const updatedVenue = await getVenueById(savedVenueId)
    if (updatedVenue) setSelectedVenue(updatedVenue)
    if (phoneGps) {
      const latDelta = 0.003
      const lngDelta = 0.003 / Math.cos(phoneGps.lat * Math.PI / 180)
      await loadVenues({
        north: phoneGps.lat + latDelta,
        south: phoneGps.lat - latDelta,
        east: phoneGps.lng + lngDelta,
        west: phoneGps.lng - lngDelta,
      })
    }

    // ── Analytics ────────────────────────────────────────────────────────────────
    await trackEvent('menu_save_success', { deviceHash, venueId: savedVenueId })
    await trackVenueEvent(savedVenueId, 'photo_upload', phoneGps)
    if (hhWindows.some(w => w !== null)) {
      await trackVenueEvent(savedVenueId, 'hh_confirm', phoneGps)
    }
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined
    const isNewVenue = !!newVenueName && !seedVenueForPromotion
    await trackEvent('scan_complete', {
      deviceHash,
      venueId: savedVenueId,
      metadata: {
        isNewVenue,
        isSeedPromotion: !!seedVenueForPromotion,
        photoCount: files.length,
        hasPhoneGps: !!phoneGps,
        hasHhData: hhWindows.some(w => w !== null),
        hhWasEdited: !!(hhSummary && menuText && hhSummary.trim() !== menuText.trim()),
        durationSec,
      },
    })

    // ── HH recovery logging ─────────────────────────────────────────────────────
    if (failedHhInput) {
      logParseFailure({ failureType: 'hh_recovery', rawText: failedHhInput, metadata: { hhSummary } })
      lastLoggedFailedText.current = ''
    }

    // ── Success toast ────────────────────────────────────────────────────────────
    const toastLabel = seedVenueForPromotion
      ? `"${seedVenueForPromotion.name}" verified`
      : newVenueName
      ? `"${newVenueName}" added`
      : `${confirmedVenue?.name ?? venueName} menu updated`
    setSaveSuccess(true)
    setLastSavedVenue(toastLabel)
    setTimeout(() => setSaveSuccess(false), 3000)
    resetScan()
  }

  async function handleMenuDiscard() {
    // Scan funnel abandonment — user manually discarded
    if (scan.startedAt) {
      await trackEvent('scan_abandon', {
        deviceHash: getDeviceHash(),
        venueId: scan.confirmedVenue?.id,
        metadata: {
          atStep: scanStep,
          photoCount: scan.files.length,
          hasParsedText: !!scan.menuText,
          hasConfirmedHh: false, // discarded = didn't confirm HH
          reason: 'manual_discard',
        },
      })
    }
    resetScan()
  }

  function handleMenuRetry() {
    // Track abandonment then immediately restart the scan funnel
    if (scan.startedAt) {
      trackEvent('scan_abandon', {
        deviceHash: getDeviceHash(),
        venueId: scan.confirmedVenue?.id,
        metadata: {
          atStep: 'review',
          photoCount: scan.files.length,
          hasParsedText: !!scan.menuText,
          reason: 'retry',
        },
      })
      // Re-fire scan_start immediately so the new attempt is linked to the old one
      trackEvent('scan_start', {
        deviceHash: getDeviceHash(),
        venueId: scan.confirmedVenue?.id,
        metadata: {
          isNewVenue: !!scan.newVenueName,
          photoCount: scan.files.length,
          hasPhoneGps: !!scan.phoneGps,
          attemptNumber: 2,  // retry = second attempt
        },
      })
    }
    resetScan()
    setScanStep('capture')
  }

  function resetScan() {
    setScan(emptyScanState())
    setScanStep('idle')
    setGpsWarning(null)
  }

  async function handleScanClose() {
    // Scan funnel abandonment — user closed scan flow without completing
    if (scan.startedAt) {
      await trackEvent('scan_abandon', {
        deviceHash: getDeviceHash(),
        venueId: scan.confirmedVenue?.id,
        metadata: {
          atStep: scanStep,
          photoCount: scan.files.length,
          hasParsedText: !!scan.menuText,
          reason: 'scan_close',
        },
      })
    }
    resetScan()
  }

  const venueToReview = scan.confirmedVenue
  const newVenueNameToReview = scan.newVenueName

  // Filter venues to what's visible in the current map bounds.
  // Operates on the lean venue shape (just lat/lng) so it works
  // with both the loaded list and any other source.
  function isVenueInBounds(
    venue: { lat: number | null; lng: number | null },
    bounds: typeof mapBounds
  ): boolean {
    if (!bounds || !venue.lat || !venue.lng) return true
    return (
      venue.lat <= bounds.north &&
      venue.lat >= bounds.south &&
      venue.lng <= bounds.east &&
      venue.lng >= bounds.west
    )
  }

  // Both map and list use the same bounds — listBounds mirrors mapBounds when switching views
  const currentBounds = listBounds ?? mapBounds
  // 4-tier sort: active > soon > today > default, then nearest-first within each tier.
  // Distance measured from searchedLocation (user's committed search center).
  // Falls back to flyToCenter (last fly-to anchor) for initial load / no-search-yet state.
  const visibleVenues = useMemo(() => {
    const anchor = searchedLocation ?? flyToCenter
    const anchorLat = anchor?.lat ?? 0
    const anchorLng = anchor?.lng ?? 0
    const now = new Date()
    const TIER: Record<string, number> = { active: 0, hh_soon: 1, hh_today: 2, default: 3 }
    return venues
      .filter(v => isVenueInBounds(v, currentBounds) && isListed(v))
      .map(v => {
        const state = getHHState(v, now)
        const tier = TIER[state] ?? 3
        const dist = (v.lat != null && v.lng != null && anchor != null)
          ? haversineM(anchorLat, anchorLng, v.lat, v.lng)
          : Infinity
        return { ...v, _tier: tier, _dist: dist }
      })
      .sort((a, b) => a._tier - b._tier || a._dist - b._dist)
  }, [venues, currentBounds, searchedLocation, flyToCenter])

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Search bar — hidden during venue detail */}
      {!selectedVenue && (
        <SearchBar
          onSearch={handleSearch}
          onVenueSelect={handleVenueSelect}
          onClear={handleSearchClear}
        />
      )}

      {/* Tab bar — hidden during venue detail */}
      {!selectedVenue && (
        <div className="shrink-0 flex border-b border-gray-200 bg-white z-10">
          <button
            onClick={() => setViewMode('map')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              viewMode === 'map'
                ? 'text-amber-600 border-b-2 border-amber-500'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Map
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'text-amber-600 border-b-2 border-amber-500'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            List
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-gray-500 text-sm mt-3">Loading venues...</p>
            </div>
          </div>
        ) : (
          // Map is always mounted so the user's pan + zoom persists
          // across view-mode toggles. In list view the list overlays
          // the map (absolute, white bg, z-10); in map view the list
          // is a sidebar on md+ and the map owns the full width on
          // mobile. The map's flyToUserLocation useEffect fires once
          // on initial mount and stays silent across toggles because
          // the component never unmounts.
          <div className="flex-1 relative">
            <Map
              venues={visibleVenues}
              selectedVenue={selectedVenue}
              onVenueSelect={handleVenueSelect}
              flyToUserLocation={userLocation}
              showUserLocation={!deepLinkActive}
              suppressUserLocation={deepLinkActive}
              onBoundsChange={(bounds) => {
                setMapBounds(bounds); setListBounds(bounds)
                handleMapMove()
              }}
              onMapReady={(fn) => setGetMapCenter(() => fn)}
              zoomToUser={zoomToUserTick}
              onZoomChange={handleMapMove}
              onUserPan={handleUserPan}
            />

            {/* Map-view-only controls: hidden behind the list overlay in list view. */}
            {viewMode === 'map' && (
              <>
                {/* "Search this area" button — reloads venues from the current map center. */}
                {showSearchThisArea && (
                  <button
                    onClick={handleSearchHereClick}
                    className="absolute left-3 bottom-20 z-10 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white pl-3 pr-4 py-2.5 rounded-full shadow-xl text-sm font-semibold flex items-center gap-2 transition-colors"
                    title="Search this area"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    Search this area
                  </button>
                )}
                {/* ? — re-open the onboarding modal any time */}
                <button
                  onClick={() => setOnboardingOpen(true)}
                  className="absolute right-3 bottom-32 z-10 w-10 h-10 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-400 hover:text-amber-600 rounded-full shadow-lg flex items-center justify-center text-lg font-semibold transition-colors"
                  title="How it works"
                >
                  ?
                </button>
                <button
                  onClick={handleZoomToUser}
                  className="absolute right-3 bottom-20 z-10 bg-white hover:bg-gray-50 active:bg-gray-100 text-amber-600 p-2.5 rounded-full shadow-lg transition-colors"
                  title="My location"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  </svg>
                </button>
              </>
            )}

            {/* List rendering: sidebar in map view (md+), full overlay in list view. */}
            {viewMode === 'map' ? (
              <div className="hidden md:block absolute right-0 top-0 bottom-0 w-80 bg-white border-l border-gray-200 overflow-y-auto">
                <VenueList
                  venues={visibleVenues}
                  mapBounds={currentBounds}
                  areaName={areaName}
                  selectedVenue={selectedVenue}
                  onVenueSelect={handleVenueSelect}
                  capped={capped}
                />
              </div>
            ) : (
              <div className="absolute inset-0 bg-white overflow-y-auto z-10">
                <VenueList
                  venues={visibleVenues}
                  mapBounds={currentBounds}
                  areaName={areaName}
                  selectedVenue={selectedVenue}
                  onVenueSelect={handleVenueSelect}
                  capped={capped}
                />
              </div>
            )}
          </div>
        )}

        {selectedVenue && (
          <VenueDetail
            venue={selectedVenue}
            onClose={() => setSelectedVenue(null)}
            onScanMenu={(v) => {
              setScan(prev => ({ ...emptyScanState(), confirmedVenue: v }))
              setScanStep('capture')
            }}
          />
        )}

      </div>

      {/* Only show bottom nav when NO venue is selected */}
      {!selectedVenue && (
        <>
          <button
            onClick={() => setSelectedVenue(null)}
            className="shrink-0 w-full text-center text-xs text-gray-400 hover:text-amber-600 py-2 border-t border-gray-100 transition-colors"
          >
            ← Back to Map
          </button>

          {/* GPS presence warning — blocks scan progression */}
          {gpsWarning && (
            <div
              role="alert"
              className="fixed top-0 left-0 right-0 z-[200] bg-red-600 text-white px-4 py-4 flex items-start gap-3"
            >
              <span className="text-lg leading-none shrink-0 mt-0.5">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-snug">{gpsWarning}</p>
              </div>
              <button
                onClick={() => { setGpsWarning(null); resetScan() }}
                className="text-white/70 hover:text-white text-xl leading-none shrink-0"
                aria-label="Dismiss and go back"
              >
                ×
              </button>
            </div>
          )}

          {/* Location-unavailable toast — fixed, doesn't push layout */}
          {locationToast && (
            <div
              role="status"
              className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] max-w-sm mx-4 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-start gap-3"
            >
              <span className="text-sm leading-snug flex-1">
                Couldn't find your location — showing the default area. Enable location for nearby venues.
              </span>
              <button
                onClick={() => setLocationToast(false)}
                className="text-gray-400 hover:text-white text-lg leading-none shrink-0 -mt-0.5"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {/* Bottom bar */}
          <div className="shrink-0 p-4 bg-white border-t border-gray-100">
            {saveSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
                <span className="text-green-600 text-sm font-semibold">✓ Saved</span>
                <span className="text-sm text-green-700">
                  {lastSavedVenue}
                </span>
              </div>
            )}

            {/* Donation ask: shown after 3rd open, always dismissible */}
            {appOpenCount >= 3 && (
              <button
                onClick={() => setSupportOpen(true)}
                className="w-full text-center text-xs text-gray-400 hover:text-amber-600 py-1 mb-2 transition-colors"
              >
                Enjoying PourList? Tip the developers $1 →
              </button>
            )}

            <button
              onClick={() => setScanStep('scan_start')}
              className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white py-4 px-6 rounded-2xl font-bold text-base shadow-lg flex items-center justify-center gap-3 transition-colors"
            >
              <span className="text-xl">📷</span>
              Scan Menu
            </button>
            <p className="text-xs text-gray-400 text-center mt-2">
              Find a venue or add a new one
            </p>
          </div>
        </>
      )}

      {/* ── Scan workflow screens ─────────────────────────────────────────── */}

      {scanStep === 'scan_start' && (
        <ScanStart
          onVenueSelected={handleScanStartVenueSelected}
          onAddVenue={handleScanStartAddVenue}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'capture' && (
        <MenuCapture
          onCapture={handleCapture}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'seed_match' && scan.seedMatch && (
        <SeedMatchConfirm
          seedVenue={scan.seedMatch}
          files={scan.files}
          phoneGps={scan.phoneGps}
          onConfirm={handleSeedMatchConfirm}
          onDeny={handleSeedMatchDeny}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'venue_picker' && (
        <VenuePicker
          files={scan.files}
          phoneGps={scan.phoneGps}
          onVenueConfirmed={handleVenueConfirmed}
          onVenueNotListed={handleVenueNotListed}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'name_entry' && (
        <NameEntry
          gps={scan.phoneGps}
          onVenueMatched={handleVenueMatched}
          onVenueCreated={handleVenueCreated}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'review' && (
        <MenuReview
          files={scan.files}
          phoneGps={scan.phoneGps}
          venueGps={venueToReview && venueToReview.lat != null && venueToReview.lng != null
            ? { lat: venueToReview.lat, lng: venueToReview.lng }
            : scan.phoneGps}
          venue={venueToReview}
          newVenueName={newVenueNameToReview}
          seedVenueName={scan.seedVenueForPromotion?.name ?? null}
          menuText={scan.menuText}
          onCommit={handleMenuCommit}
          onDiscard={handleMenuDiscard}
          onRetry={handleMenuRetry}
          onClose={handleScanClose}
          onParseFailureAttempt={handleHhParseFailureAttempt}
        />
      )}

      {onboardingOpen && (
        <OnboardingModal onClose={() => setOnboardingOpen(false)} />
      )}

      {supportOpen && (
        <SupportScreen onClose={() => setSupportOpen(false)} />
      )}
    </div>
  )
}

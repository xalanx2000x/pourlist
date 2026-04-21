'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { getVenuesByProximity } from '@/lib/venues'
import { checkHappyHour } from '@/lib/happyHourCheck'
import type { Venue } from '@/lib/supabase'
import VenueList from '@/components/VenueList'
import VenueDetail from '@/components/VenueDetail'

import MenuCapture from '@/components/MenuCapture'
import VenuePicker from '@/components/VenuePicker'
import ScanStart from '@/components/ScanStart'
import NameEntry from '@/components/NameEntry'
import MenuReview from '@/components/MenuReview'
import SupportScreen from '@/components/SupportScreen'
import OnboardingModal, { useOnboarding } from '@/components/OnboardingModal'
import { trackEvent } from '@/lib/analytics'
import { checkRateLimit } from '@/lib/rateLimit'
import { getDeviceHash } from '@/lib/device'
import { getBrowserLocation } from '@/lib/gps'
import SearchBar from '@/components/SearchBar'

const Map = dynamic(() => import('@/components/Map'), { ssr: false })

type ViewMode = 'map' | 'list'

// ── New scan step state machine ───────────────────────────────────────────
type ScanStep =
  | 'idle'
  | 'scan_start'    // ScanStart — location check + venue list + add venue option
  | 'capture'       // MenuCapture — taking 1–4 photos
  | 'venue_picker'  // VenuePicker — GPS available, confirm nearby venue
  | 'name_entry'   // NameEntry — type venue name, fuzzy match
  | 'review'       // MenuReview — edit HH time + menu text, commit

type ScanState = {
  files: File[]
  gps: { lat: number; lng: number } | null
  confirmedVenue: Venue | null
  newVenueName: string | null
  parsedText: string
  hhTimes: string[]
  isNotHH: boolean
  parseError: string
}

const RADIUS_OPTIONS = [
  { label: '¼ mi', value: 0.25 },
  { label: '½ mi', value: 0.5 },
  { label: '1 mi', value: 1 },
  { label: '2 mi', value: 2 },
  { label: '5 mi', value: 5 },
  { label: '10 mi', value: 10 },
  { label: '25 mi', value: 25 },
]

function emptyScanState(): ScanState {
  return {
    files: [],
    gps: null,
    confirmedVenue: null,
    newVenueName: null,
    parsedText: '',
    hhTimes: [],
    isNotHH: false,
    parseError: ''
  }
}

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [radius, setRadius] = useState(5)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null)
  const [zoomToUserTick, setZoomToUserTick] = useState(0)
  const showOnboarding = useOnboarding()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [searchedLocation, setSearchedLocation] = useState<{ lat: number; lng: number } | null>(null)
  const originalGpsLocation = { lat: 45.523, lng: -122.676 }

  // Show onboarding once on first visit
  useEffect(() => {
    if (showOnboarding) setOnboardingOpen(true)
  }, [showOnboarding])

  // ── Scan workflow state ──────────────────────────────────────────────────
  const [scanStep, setScanStep] = useState<ScanStep>('idle')
  const [scan, setScan] = useState<ScanState>(emptyScanState())
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const loadVenues = useCallback(async (overrides?: { lat: number; lng: number }): Promise<Venue[]> => {
    try {
      // Location priority: explicit override (scan GPS) > userLocation > nothing
      // We do NOT fall back to Portland center — that was a dev convenience.
      // If no location is available, show an empty map and wait for the user to pan.
      const searchLat = overrides?.lat ?? userLocation?.lat
      const searchLng = overrides?.lng ?? userLocation?.lng

      if (searchLat == null || searchLng == null) {
        setVenues([])
        return []
      }

      const radiusMeters = radius * 1609.34
      const data = await getVenuesByProximity(searchLat, searchLng, radiusMeters)
      setVenues(data)
      // Reset map bounds so newly loaded venues show in full (unfiltered)
      // until map moves again via moveend
      setMapBounds(null)
      return data
    } catch (err) {
      console.error('Failed to load venues:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [userLocation, radius])

  useEffect(() => {
    loadVenues()
  }, [loadVenues])

  // Get user location on mount
  useEffect(() => {
    getBrowserLocation()
      .then(loc => setUserLocation(loc))
      .catch(() => {})
  }, [])


  function handleSearchClear() {
    setSearchedLocation(originalGpsLocation)
    setUserLocation(originalGpsLocation)
    setMapBounds(null)
  }

  function handleSearch(coords: { lat: number; lng: number }) {
    setSearchedLocation(coords)
    setUserLocation(coords)
    setMapBounds(null)
  }

  function handleVenueSelect(venue: Venue) {
    trackEvent('venue_view', { deviceHash: getDeviceHash(), venueId: venue.id })
    setSelectedVenue(venue)
    setVenues(prev => {
      if (prev.some(v => v.id === venue.id)) return prev
      return [venue, ...prev]
    })
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
   *   - GPS available → verify within 50m → proceed to review
   *   - No GPS → name_entry (confirm or create venue)
   *
   * If no venue pre-selected (user tapped "Add Venue"):
   *   - GPS available → venue_picker (show nearby venues to snap to)
   *   - No GPS → name_entry
   */
  function handleCapture(files: File[], gps: { lat: number; lng: number } | null) {
    const confirmedVenue = scan.confirmedVenue

    if (confirmedVenue && confirmedVenue.lat != null && confirmedVenue.lng != null && gps != null) {
      // Venue pre-selected → verify GPS is within 50m
      const R = 6371000
      const toRad = (deg: number) => (deg * Math.PI) / 180
      const dLat = (gps.lat - confirmedVenue.lat) * Math.PI / 180
      const dLng = (gps.lng - confirmedVenue.lng) * Math.PI / 180
      const a = Math.sin(dLat/2)**2 +
                Math.cos(toRad(confirmedVenue.lat)) * Math.cos(toRad(gps.lat)) *
                Math.sin(dLng/2)**2
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
      const distance = R * c

      if (distance <= 50) {
        // GPS matches venue — proceed to review directly
        setScan(prev => ({ ...prev, files, gps }))
        transitionToReview(confirmedVenue, null)
        return
      } else {
        // GPS too far from pre-selected venue — force name entry
        setScan(prev => ({ ...prev, files, gps }))
        setScanStep('name_entry')
        return
      }
    }

    // No pre-selected venue — use original flow
    setScan(prev => ({ ...prev, files, gps }))

    if (gps != null) {
      setScanStep('venue_picker')
    } else {
      setScanStep('name_entry')
    }
  }

  /**
   * Step 2a: Venue confirmed from VenuePicker → proceed to parse + review.
   */
  function handleVenueConfirmed(venue: Venue) {
    setScan(prev => ({ ...prev, confirmedVenue: venue }))
    transitionToReview(venue, null)
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
  function handleVenueMatched(venue: Venue) {
    setScan(prev => ({ ...prev, confirmedVenue: venue }))
    transitionToReview(venue, null)
  }

  /**
   * Step 3b: User wants to create a new venue from NameEntry.
   */
  function handleVenueCreated(name: string) {
    setScan(prev => ({ ...prev, newVenueName: name }))
    transitionToReview(null, name)
  }

  /**
   * Parse all photos in parallel, then show MenuReview.
   */
  async function transitionToReview(venue: Venue | null, newVenueName: string | null) {
    setScanLoading(true)
    setScanError('')

    try {
      const { fileToBase64 } = await import('@/lib/imageResize')
      const files = scan.files

      // Convert all files to base64
      const imageDataUrls: string[] = []
      for (const file of files) {
        const dataUrl = await fileToBase64(file, 1.5)
        imageDataUrls.push(dataUrl)
      }

      // Parse all photos in parallel
      const texts: string[] = []
      const parseErrors: string[] = []
      for (let i = 0; i < imageDataUrls.length; i++) {
        const parseRes = await fetch('/api/parse-menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: imageDataUrls[i] })
        })

        if (parseRes.ok) {
          const data = await parseRes.json()
          if (data.text) {
            texts.push(data.text)
          } else if (data.error) {
            // Parse succeeded but returned an error (e.g., OpenAI rejected the image)
            parseErrors.push(`Page ${i + 1}: ${data.error}`)
          }
        } else {
          const errText = await parseRes.text()
          const msg = `Page ${i + 1} error (${parseRes.status}): ${errText}`
          console.error(`[PourList] ${msg}`)
          parseErrors.push(msg)
        }
      }

      const combined = texts.join('\n\n--- Page ---\n\n')
      const hh = checkHappyHour(combined)

      setScan(prev => ({
        ...prev,
        confirmedVenue: venue,
        newVenueName: newVenueName ?? prev.newVenueName,
        parsedText: combined || '',
        hhTimes: hh.times,
        isNotHH: !hh.isHappyHour,
        parseError: texts.length === 0 ? (parseErrors[0] ?? 'No menu text detected') : ''
      }))

      if (texts.length > 0) {
        await trackEvent('menu_parse_success', {
          deviceHash: getDeviceHash(),
          metadata: { pageCount: texts.length }
        })
      } else {
        await trackEvent('menu_parse_failure', { deviceHash: getDeviceHash() })
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Something went wrong')
      setScan(prev => ({ ...prev, parsedText: '' }))
    } finally {
      setScanLoading(false)
      setScanStep('review')
    }
  }

  /**
   * Commit the menu: upload photos + save venue.
   */
  async function handleMenuCommit(menuText: string, hhTime: string) {
    const deviceHash = getDeviceHash()
    const limit = checkRateLimit(deviceHash)
    if (!limit.allowed) {
      const s = Math.ceil((limit.retryAfterMs || 0) / 1000)
      throw new Error(`Slow down! Please wait ${s}s before submitting again.`)
    }

    const { confirmedVenue, newVenueName, files, gps } = scan
    const isNewVenue = !confirmedVenue && newVenueName

    // Step 1: Upload photos
    const formData = new FormData()
    for (const file of files) {
      formData.append('photos', file)
    }
    if (gps) {
      formData.append('lat', String(gps.lat))
      formData.append('lng', String(gps.lng))
    }
    formData.append('deviceHash', deviceHash)
    formData.append('menuText', menuText)
    if (hhTime) formData.append('hhTime', hhTime)

    let venueId: string | undefined
    let createdVenueId: string | undefined

    if (confirmedVenue) {
      formData.append('venueId', confirmedVenue.id)
      venueId = confirmedVenue.id
    } else if (newVenueName) {
      // Create the new venue first
      const createRes = await fetch('/api/create-venue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVenueName,
          lat: gps?.lat ?? null,
          lng: gps?.lng ?? null,
          address: null,
          deviceHash
        })
      })
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create venue')
      }
      const newVenue = await createRes.json()
      createdVenueId = newVenue.id
      formData.append('venueId', newVenue.id)
      venueId = newVenue.id
    }

    // Step 2: Commit (upload photos + update venue)
    const commitRes = await fetch('/api/commit-menu', {
      method: 'POST',
      body: formData
    })

    if (!commitRes.ok) {
      const err = await commitRes.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to save menu')
    }

    const { venueId: savedVenueId } = await commitRes.json()

    // Refresh venue list using the scan's GPS (user's actual location at time of scan)
    // This ensures the venue they just updated is included in the reload results
    const freshVenues = await loadVenues(scan.gps ?? undefined)

    // Update selectedVenue using the freshly loaded data directly.
    // This avoids closure issues with stale React state.
    const updatedVenue = freshVenues.find(v => v.id === savedVenueId)
    if (updatedVenue) setSelectedVenue(updatedVenue)

    await trackEvent('menu_save_success', { deviceHash, venueId: savedVenueId })

    // Success feedback
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)

    // Reset scan workflow
    resetScan()
  }

  function handleMenuDiscard() {
    resetScan()
  }

  function handleMenuRetry() {
    resetScan()
    setScanStep('capture')
  }

  function resetScan() {
    setScan(emptyScanState())
    setScanStep('idle')
    setScanError('')
  }

  function handleScanClose() {
    resetScan()
  }

  const venueToReview = scan.confirmedVenue
  const newVenueNameToReview = scan.newVenueName

  // Filter venues to what's visible in the current map bounds
  function isVenueInBounds(venue: Venue, bounds: typeof mapBounds): boolean {
    if (!bounds || !venue.lat || !venue.lng) return true
    return (
      venue.lat <= bounds.north &&
      venue.lat >= bounds.south &&
      venue.lng <= bounds.east &&
      venue.lng >= bounds.west
    )
  }

  const visibleVenues = venues.filter(v => isVenueInBounds(v, mapBounds))

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between shadow-md z-10">
        <h1 className="text-lg font-bold tracking-tight">The Pour List</h1>
      </header>

      {/* Search bar */}
      <SearchBar
        onSearch={handleSearch}
        onVenueSelect={handleVenueSelect}
        onClear={handleSearchClear}
      />

      {/* Tab bar */}
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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-gray-500 text-sm mt-3">Loading venues...</p>
            </div>
          </div>
        ) : viewMode === 'map' ? (
          <>
            <div className="flex-1 relative">
              <Map
                venues={visibleVenues}
                selectedVenue={selectedVenue}
                onVenueSelect={handleVenueSelect}
                flyToUserLocation={userLocation}
                showUserLocation={true}
                onBoundsChange={setMapBounds}
                zoomToUser={zoomToUserTick}
              />
              {/* Zoom to user button */}
              <button
                onClick={() => {
                  if (!userLocation) {
                    navigator.geolocation.getCurrentPosition(
                      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                      () => {}
                    )
                  }
                  setZoomToUserTick(t => t + 1)
                }}
                className="absolute left-3 bottom-20 z-10 w-10 h-10 bg-white hover:bg-gray-50 active:bg-gray-100 rounded-full shadow-lg flex items-center justify-center text-gray-600 transition-colors"
                title="Zoom to my location"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </button>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 z-10 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg px-2 py-3">
                <span className="text-xs text-amber-600 font-semibold leading-none">
                  {RADIUS_OPTIONS.find(o => o.value === radius)?.label ?? `${radius} mi`}
                </span>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={1}
                  value={RADIUS_OPTIONS.findIndex(o => o.value === radius)}
                  onChange={(e) => setRadius(RADIUS_OPTIONS[Number(e.target.value)].value)}
                  className="vertical-slider"
                />
                <span className="text-xs text-gray-400 leading-none">mi</span>
              </div>
            </div>
            <div className="hidden md:block w-80 bg-white border-l border-gray-200 overflow-y-auto">
              <VenueList
                venues={visibleVenues}
                selectedVenue={selectedVenue}
                onVenueSelect={handleVenueSelect}
              />
            </div>
          </>
        ) : (
          <VenueList
            venues={venues}
            selectedVenue={selectedVenue}
            onVenueSelect={handleVenueSelect}
          />
        )}

        {selectedVenue && (
          <VenueDetail
            venue={selectedVenue}
            onClose={() => setSelectedVenue(null)}
          />
        )}

      </div>

      {/* Bottom bar */}
      <div className="shrink-0 p-4 bg-white border-t border-gray-100">
        {saveSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
            <span className="text-green-600 text-sm font-semibold">✓ Saved</span>
            <span className="text-sm text-green-700">
              {scan.confirmedVenue ? `${scan.confirmedVenue.name} menu updated` : 'New venue added'}
            </span>
          </div>
        )}

        <button
          onClick={() => setSupportOpen(true)}
          className="w-full text-center text-xs text-gray-400 hover:text-amber-600 py-1 mb-2 transition-colors"
        >
          Enjoying your happy hour? Tip the developers $1 →
        </button>

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

      {scanStep === 'venue_picker' && (
        <VenuePicker
          files={scan.files}
          gps={scan.gps}
          onVenueConfirmed={handleVenueConfirmed}
          onVenueNotListed={handleVenueNotListed}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'name_entry' && (
        <NameEntry
          gps={scan.gps}
          onVenueMatched={handleVenueMatched}
          onVenueCreated={handleVenueCreated}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'review' && (
        <MenuReview
          files={scan.files}
          gps={scan.gps}
          venue={venueToReview}
          newVenueName={newVenueNameToReview}
          parsedText={scan.parsedText}
          hhTimes={scan.hhTimes}
          isNotHH={scan.isNotHH}
          parseError={scan.parseError}
          onCommit={handleMenuCommit}
          onDiscard={handleMenuDiscard}
          onRetry={handleMenuRetry}
          onClose={handleScanClose}
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

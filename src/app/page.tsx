'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { Venue } from '@/lib/supabase'
import { getVenuesByProximity, getVenueById } from '@/lib/venues'
import { checkHappyHour } from '@/lib/happyHourCheck'
import { isWithinRadius } from '@/lib/gpsCheck'
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
import { getBrowserLocation } from '@/lib/gps'
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
  phoneGps: { lat: number; lng: number } | null   // phone's current GPS — fraud signal, not venue location
  exifGps: { lat: number; lng: number } | null    // EXIF GPS from first photo — authoritative venue location
  confirmedVenue: Venue | null
  newVenueName: string | null
  menuText: string | null
  startedAt: number | null  // Date.now() when scan entered review step — used for funnel duration
  seedMatch: Venue | null   // seed venue detected within 100m — Job 5
}

function emptyScanState(): ScanState {
  return {
    files: [],
    phoneGps: null,
    exifGps: null,
    confirmedVenue: null,
    newVenueName: null,
    menuText: null,
    startedAt: null,
    seedMatch: null,
  }
}

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  // Fixed radius: enough to cover any plausible search area (≈50 miles).
  // The map bounds filter what is visible, but we load a wide area so
  // panning doesn't result in empty states after a manual reload.
  const DEFAULT_RADIUS_METERS = 50 * 1609.34
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
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

/** Haversine distance in meters between two coordinates. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

  // Show onboarding automatically on first eligible visit only
  useEffect(() => {
    if (showOnboarding) setOnboardingOpen(true)
  }, [showOnboarding])

  // ── Scan workflow state ──────────────────────────────────────────────────
  const [scanStep, setScanStep] = useState<ScanStep>('idle')
  const [scan, setScan] = useState<ScanState>(emptyScanState())
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [lastSavedVenue, setLastSavedVenue] = useState<string | null>(null)
  const [gpsWarning, setGpsWarning] = useState<string | null>(null)

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

      const data = await getVenuesByProximity(searchLat, searchLng, DEFAULT_RADIUS_METERS)
      setVenues(data)
      // Reset map bounds so newly loaded venues show in full (unfiltered)
      // until map moves again via moveend
      setMapBounds(null)
      setListBounds(null)
      return data
    } catch (err) {
      console.error('Failed to load venues:', err)
      return []
    } finally {
      setLoading(false)
    }
  }, [userLocation])

  // Load venues whenever user location becomes available
  // This is the key effect that fetches nearby venues when GPS resolves.
  // Previously loadVenues was only called on mount (with null location) or map pan/zoom.
  useEffect(() => {
    if (!userLocation) return
    loadVenues()
  }, [userLocation, loadVenues])

  // Get user location on mount
  useEffect(() => {
    getBrowserLocation()
      .then(loc => setUserLocation(loc))
      .catch(() => {})
  }, [])

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
        if (feat?.text) setAreaName(feat.text)
      })
      .catch(() => {})
  }, [userLocation])


  function handleSearchClear() {
    setSearchedLocation(originalGpsLocation)
    setUserLocation(originalGpsLocation)
    setMapBounds(null)
    setListBounds(null)
  }

  function handleSearch(coords: { lat: number; lng: number }) {
    setSearchedLocation(coords)
    setUserLocation(coords)
    setMapBounds(null)
    setListBounds(null)
    setShowSearchThisArea(false)
    // Immediately reload venues at the search location
    loadVenues({ lat: coords.lat, lng: coords.lng })
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
      // Load venues immediately from the search center — map will fly in parallel
      loadVenues({ lat: center.lat, lng: center.lng })
    }
  }

  // My Location button — flies to user location. User then taps "Search this area"
  // to reload venues from their actual position.
  function handleZoomToUser() {
    if (!userLocation) return
    setZoomToUserTick(t => t + 1)
    setShowSearchThisArea(true)
  }

  async function handleVenueSelect(venue: Venue) {
    trackEvent('venue_view', { deviceHash: getDeviceHash(), venueId: venue.id })
    trackVenueEvent(venue.id, 'view', userLocation)

    // Always re-fetch from DB by ID — ensures the detail page has fresh HH and all other fields,
    // regardless of whether the venue was reached via map or search (two different discovery paths).
    const freshVenue = await getVenueById(venue.id)
    const finalVenue = freshVenue ?? venue

    setSelectedVenue(finalVenue)
    setVenues(prev => {
      if (prev.some(v => v.id === finalVenue.id)) {
        return prev.map(v => v.id === finalVenue.id ? finalVenue : v)
      }
      return [finalVenue, ...prev]
    })

    // Reload nearby venues at the selected venue's location so it appears on map
    if (finalVenue.lat != null && finalVenue.lng != null) {
      loadVenues({ lat: finalVenue.lat, lng: finalVenue.lng })
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
   *   - GPS available → verify within 50m → proceed to review
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
  async function parseMenuPhotos(files: File[]): Promise<string> {
    if (files.length === 0) return ''
    let hadFailure = false
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const base64 = await fileToBase64NoResize(file)
          const res = await fetch('/api/parse-menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: base64,
              deviceHash: getDeviceHash()
            })
          })
          if (!res.ok) {
            hadFailure = true
            return ''
          }
          const { text } = await res.json()
          return text ?? ''
        })
      )
      const combined = results.filter(Boolean).join('\n---\n')
      if (combined) {
        trackEvent('menu_parse_success', { deviceHash: getDeviceHash(), metadata: { pageCount: files.length } })
      } else if (hadFailure) {
        trackEvent('menu_parse_failure', { deviceHash: getDeviceHash(), metadata: { pageCount: files.length } })
      }
      return combined
    } catch {
      trackEvent('menu_parse_failure', { deviceHash: getDeviceHash(), metadata: { pageCount: files.length } })
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

  async function handleCapture(files: File[], phoneGps: { lat: number; lng: number } | null, exifGps: { lat: number; lng: number } | null) {
    const confirmedVenue = scan.confirmedVenue

    // Parse menu photos immediately so text is ready for MenuReview
    const menuText = await parseMenuPhotos(files)

    if (confirmedVenue) {
      // Existing venue path — verify user GPS is near the venue before proceeding.
      // (phoneGps is the fraud check signal, compared against venue's known coordinates)
      if (phoneGps && confirmedVenue.lat != null && confirmedVenue.lng != null) {
        const withinRange = isWithinRadius(phoneGps.lat, phoneGps.lng, confirmedVenue.lat, confirmedVenue.lng, 100)
        if (!withinRange) {
          setGpsWarning('Your location seems far from this venue. Are you sure you\'re here?')
        }
      }
      setScan(prev => ({ ...prev, files, phoneGps, exifGps, menuText }))
      await transitionToReview(confirmedVenue, null)
      return
    }

    // No venue pre-selected:
    // - exifGps = authoritative venue location (from first photo's EXIF)
    // - phoneGps = fraud check signal (phone's current location)
    // Use EXIF GPS as venueProposedCoords; if absent, fall back to phone GPS
    const venueProposedCoords = exifGps ?? phoneGps
    setScan(prev => ({ ...prev, files, phoneGps, exifGps: venueProposedCoords, menuText }))

    // ── Job 5: Seed venue proximity check ────────────────────────────────
    // Before showing the venue_picker, check if there's a seed venue within 100m.
    // If found, show "Did you mean this venue?" instead of the normal venue_picker.
    if (venueProposedCoords != null) {
      try {
        const seedVenues = await getVenuesByProximity(venueProposedCoords.lat, venueProposedCoords.lng, 100)
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
    const { files, exifGps, phoneGps, menuText } = scan
    if (!exifGps) {
      // Fall back to name_entry if no GPS
      setScan(prev => ({ ...prev, seedMatch: null }))
      setScanStep('name_entry')
      return
    }

    const formData = new FormData()
    formData.append('seedVenueId', seedVenue.id)
    formData.append('exifLat', String(exifGps.lat))
    formData.append('exifLng', String(exifGps.lng))
    if (phoneGps) {
      formData.append('phoneLat', String(phoneGps.lat))
      formData.append('phoneLng', String(phoneGps.lng))
    }
    formData.append('deviceHash', getDeviceHash())
    for (const file of files) formData.append('photos', file)

    const res = await fetch('/api/submit-venue', { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to promote venue')
    }

    const savedVenueId = data.venueId
    const updatedVenue = await getVenueById(savedVenueId)
    if (updatedVenue) setSelectedVenue(updatedVenue)
    const freshVenues = await loadVenues(exifGps ? { lat: exifGps.lat, lng: exifGps.lng } : undefined)
    const refreshed = freshVenues.find(v => v.id === savedVenueId)
    if (refreshed) setSelectedVenue(refreshed)

    await trackEvent('menu_save_success', { deviceHash: getDeviceHash(), venueId: savedVenueId })
    await trackVenueEvent(savedVenueId, 'photo_upload', exifGps)

    setSaveSuccess(true)
    setLastSavedVenue(`"${seedVenue.name}" verified`)
    setTimeout(() => setSaveSuccess(false), 3000)
    resetScan()
  }

  /**
   * Job 6: User denied the seed venue match — proceed to name_entry.
   */
  function handleSeedMatchDeny() {
    setScan(prev => ({ ...prev, seedMatch: null }))
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
        hasExifGps: !!scan.exifGps,
      },
    })
  }

  /**
   * Commit the menu: upload photos + save venue with structured HH schedule.
   */
  async function handleMenuCommit(data: {
    hhWindows: [import('@/lib/parse-hh').HHWindow | null, import('@/lib/parse-hh').HHWindow | null, import('@/lib/parse-hh').HHWindow | null]
    hhTime: string
    hhSummary: string
  }) {
    const { hhWindows, hhTime, hhSummary } = data
    const deviceHash = getDeviceHash()
    const limit = checkRateLimit(deviceHash)
    if (!limit.allowed) {
      const s = Math.ceil((limit.retryAfterMs || 0) / 1000)
      throw new Error(`Slow down! Please wait ${s}s before submitting again.`)
    }

    const { confirmedVenue, newVenueName, files, phoneGps, exifGps, menuText, startedAt } = scan

    // ── Existing venue path → commit-menu ─────────────────────────────────
    if (confirmedVenue) {
      const { fileToBase64 } = await import('@/lib/fileToBase64')
      const formData = new FormData()
      // Compress photos before upload (max 1.5MB JPEG each)
      // Prevents large-request timeouts on slow connections
      for (const file of files) {
        const base64 = await fileToBase64(file, 1.5)
        formData.append('photos', base64)
      }
      if (phoneGps) {
        formData.append('lat', String(phoneGps.lat))
        formData.append('lng', String(phoneGps.lng))
      }
      formData.append('deviceHash', deviceHash)
      if (hhTime) formData.append('hhTime', hhTime)
      if (hhSummary) formData.append('hhSummary', hhSummary)

      const w1 = hhWindows[0]; const w2 = hhWindows[1]; const w3 = hhWindows[2]
      function appendWindow(w: import('@/lib/parse-hh').HHWindow, prefix: string, daysKey: string, exclKey: string) {
        if (!w.type) return
        formData.append(prefix, w.type)
        formData.append(daysKey, String(w.days.join(',')))
        formData.append(prefix.replace('type', 'start'), w.startMin != null ? String(w.startMin) : '')
        formData.append(prefix.replace('type', 'end'), w.endMin != null ? String(w.endMin) : '')
        if (w.excludeDays?.length) formData.append(exclKey, String(w.excludeDays.join(',')))
      }
      if (w1?.type) appendWindow(w1, 'hh_type', 'hh_days', 'hh_exclude_days')
      if (w2?.type) appendWindow(w2, 'hh_type_2', 'hh_days_2', 'hh_exclude_days_2')
      if (w3?.type) appendWindow(w3, 'hh_type_3', 'hh_days_3', 'hh_exclude_days_3')

      formData.append('venueId', confirmedVenue.id)

      const commitRes = await fetch('/api/commit-menu', { method: 'POST', body: formData })
      if (!commitRes.ok) {
        const err = await commitRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save menu')
      }

      const { venueId: savedVenueId } = await commitRes.json()
      const updatedVenue = await getVenueById(savedVenueId)
      if (updatedVenue) setSelectedVenue(updatedVenue)
      const freshVenues = await loadVenues(phoneGps ?? undefined)
      const refreshed = freshVenues.find(v => v.id === savedVenueId)
      if (refreshed) setSelectedVenue(refreshed)

      await trackEvent('menu_save_success', { deviceHash, venueId: savedVenueId })
      await trackVenueEvent(savedVenueId, 'photo_upload', phoneGps)
      if (hhWindows.some(w => w !== null)) {
        await trackVenueEvent(savedVenueId, 'hh_confirm', phoneGps)
      }

      // Scan funnel completion + HH signal
      const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined
      await trackEvent('scan_complete', {
        deviceHash,
        venueId: savedVenueId,
        metadata: {
          isNewVenue: false,
          photoCount: files.length,
          hasPhoneGps: !!phoneGps,
          hasHhData: hhWindows.some(w => w !== null),
          hhWasEdited: !!(hhSummary && scan.menuText && hhSummary.trim() !== scan.menuText.trim()),
          durationSec,
        },
      })

      setSaveSuccess(true)
      setLastSavedVenue(`${confirmedVenue.name} menu updated`)
      setTimeout(() => setSaveSuccess(false), 3000)
      resetScan()
      return
    }

    // ── New venue path → submit-venue (single endpoint) ───────────────────
    if (newVenueName) {
      if (!exifGps) {
        throw new Error('No location found. Please take the photo at the venue.')
      }

      const formData = new FormData()
      formData.append('venueName', newVenueName)
      formData.append('exifLat', String(exifGps.lat))
      formData.append('exifLng', String(exifGps.lng))
      if (phoneGps) {
        formData.append('phoneLat', String(phoneGps.lat))
        formData.append('phoneLng', String(phoneGps.lng))
      }
      formData.append('deviceHash', deviceHash)
      if (hhSummary) formData.append('hhSummary', hhSummary)

      const w1 = hhWindows[0]; const w2 = hhWindows[1]; const w3 = hhWindows[2]
      function appendWindow(w: import('@/lib/parse-hh').HHWindow, prefix: string, daysKey: string, exclKey: string) {
        if (!w.type) return
        formData.append(prefix, w.type)
        formData.append(daysKey, String(w.days.join(',')))
        formData.append(prefix.replace('type', 'start'), w.startMin != null ? String(w.startMin) : '')
        formData.append(prefix.replace('type', 'end'), w.endMin != null ? String(w.endMin) : '')
        if (w.excludeDays?.length) formData.append(exclKey, String(w.excludeDays.join(',')))
      }
      if (w1?.type) appendWindow(w1, 'hh_type', 'hh_days', 'hh_exclude_days')
      if (w2?.type) appendWindow(w2, 'hh_type_2', 'hh_days_2', 'hh_exclude_days_2')
      if (w3?.type) appendWindow(w3, 'hh_type_3', 'hh_days_3', 'hh_exclude_days_3')

      for (const file of files) formData.append('photos', file)

      const submitRes = await fetch('/api/submit-venue', { method: 'POST', body: formData })

      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to create venue')
      }

      const result = await submitRes.json()

      if (!result.success) {
        if (result.reason === 'duplicate' && result.existingVenue) {
          // Dedup: suggest updating existing venue instead
          const existing = result.existingVenue
          throw new Error(`"${newVenueName}" already exists nearby as "${existing.name}". Want to update that instead?`)
        }
        throw new Error(result.reason === 'photo_upload_failed'
          ? 'Photos failed to upload. Please try again.'
          : 'Failed to create venue. Please try again.')
      }

      const { venueId: savedVenueId } = result

      // Refresh map and select the new venue
      const updatedVenue = await getVenueById(savedVenueId)
      if (updatedVenue) setSelectedVenue(updatedVenue)
      const freshVenues = await loadVenues(exifGps ? { lat: exifGps.lat, lng: exifGps.lng } : undefined)
      const refreshed = freshVenues.find(v => v.id === savedVenueId)
      if (refreshed) setSelectedVenue(refreshed)

      await trackEvent('menu_save_success', { deviceHash, venueId: savedVenueId })
      await trackVenueEvent(savedVenueId, 'photo_upload', exifGps)
      if (hhWindows.some(w => w !== null)) {
        await trackVenueEvent(savedVenueId, 'hh_confirm', exifGps)
      }

      // Scan funnel completion (new venue path)
      const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined
      await trackEvent('scan_complete', {
        deviceHash,
        venueId: savedVenueId,
        metadata: {
          isNewVenue: true,
          photoCount: files.length,
          hasPhoneGps: !!phoneGps,
          hasHhData: hhWindows.some(w => w !== null),
          hhWasEdited: !!(hhSummary && menuText && hhSummary.trim() !== menuText.trim()),
          durationSec,
        },
      })

      setSaveSuccess(true)
      setLastSavedVenue(`"${newVenueName}" added`)
      setTimeout(() => setSaveSuccess(false), 3000)
      resetScan()
      return
    }

    throw new Error('No venue selected and no new venue name. Please start over.')
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
          hasExifGps: !!scan.exifGps,
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

  // Both map and list use the same bounds — listBounds mirrors mapBounds when switching views
  const currentBounds = listBounds ?? mapBounds
  const visibleVenues = venues.filter(v => isVenueInBounds(v, currentBounds))

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
        ) : viewMode === 'map' ? (
          <>
            <div className="flex-1 relative">
              <Map
                venues={visibleVenues}
                selectedVenue={selectedVenue}
                onVenueSelect={handleVenueSelect}
                flyToUserLocation={userLocation}
                showUserLocation={true}
                onBoundsChange={(bounds) => {
                  setMapBounds(bounds); setListBounds(bounds)
                  handleMapMove()
                }}
                onMapReady={(fn) => setGetMapCenter(() => fn)}
                zoomToUser={zoomToUserTick}
                onZoomChange={handleMapMove}
              />
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
              {/* My Location button — flies to user location. Does not auto-reload. */}
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
            </div>
            <div className="hidden md:block w-80 bg-white border-l border-gray-200 overflow-y-auto">
              <VenueList
                venues={visibleVenues}
                mapBounds={currentBounds}
                areaName={areaName}
                selectedVenue={selectedVenue}
                onVenueSelect={handleVenueSelect}
              />
            </div>
          </>
        ) : (
          <VenueList
            venues={visibleVenues}
            mapBounds={currentBounds}
            areaName={areaName}
            selectedVenue={selectedVenue}
            onVenueSelect={handleVenueSelect}
          />
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
          onConfirm={handleSeedMatchConfirm}
          onDeny={handleSeedMatchDeny}
          onClose={handleScanClose}
        />
      )}

      {scanStep === 'venue_picker' && (
        <VenuePicker
          files={scan.files}
          phoneGps={scan.phoneGps}
          exifGps={scan.exifGps}
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
            : scan.exifGps}
          venue={venueToReview}
          newVenueName={newVenueNameToReview}
          menuText={scan.menuText}
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

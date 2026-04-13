'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { getVenuesByZip } from '@/lib/venues'
import { fingerprintFile } from '@/lib/imageHash'
import { checkHappyHour } from '@/lib/happyHourCheck'
import type { Venue } from '@/lib/supabase'
import VenueList from '@/components/VenueList'
import VenueDetail from '@/components/VenueDetail'
import AddVenueForm from '@/components/AddVenueForm'
import MenuCapture from '@/components/MenuCapture'
import MenuConfirm from '@/components/MenuConfirm'
import SupportScreen from '@/components/SupportScreen'
import OnboardingModal, { useOnboarding } from '@/components/OnboardingModal'
import { trackEvent } from '@/lib/analytics'
import { checkRateLimit } from '@/lib/rateLimit'
import { getDeviceHash } from '@/lib/device'
import { extractGpsFromPhoto, getBrowserLocation } from '@/lib/gps'


const Map = dynamic(() => import('@/components/Map'), { ssr: false })

type ViewMode = 'map' | 'list'

const RADIUS_OPTIONS = [
  { label: '¼ mi', value: 0.25 },
  { label: '½ mi', value: 0.5 },
  { label: '1 mi', value: 1 },
  { label: '2 mi', value: 2 },
  { label: '5 mi', value: 5 },
  { label: '10 mi', value: 10 },
  { label: '25 mi', value: 25 },
]

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [showAddVenue, setShowAddVenue] = useState(false)
  const [radius, setRadius] = useState(1)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const showOnboarding = useOnboarding()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)

  // Show onboarding once on first visit
  useEffect(() => {
    if (showOnboarding) setOnboardingOpen(true)
  }, [showOnboarding])

  // Menu scan workflow state
  const [scanStep, setScanStep] = useState<'idle' | 'capture' | 'confirm'>('idle')
  const [scanFiles, setScanFiles] = useState<File[]>([])
  const [scanGps, setScanGps] = useState<{ lat: number; lng: number } | null>(null)
  const [parsedText, setParsedText] = useState('')
  const [matchedVenue, setMatchedVenue] = useState<Venue | null>(null)
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [isNotHH, setIsNotHH] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [submitLoading, setSubmitLoading] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [rateLimitError, setRateLimitError] = useState<string | null>(null)

  const loadVenues = useCallback(async () => {
    try {
      const data = await getVenuesByZip('97209')
      // Filter by radius from user location if available
      let filtered = data
      if (userLocation) {
        filtered = data.filter(v => {
          if (!v.lat || !v.lng) return true
          const km = Math.sqrt(
            Math.pow((v.lat - userLocation.lat) * 111, 2) +
            Math.pow((v.lng - userLocation.lng) * 85, 2)
          )
          const miles = km * 0.621371
          return miles <= radius
        })
      }
      setVenues(filtered)
    } catch (err) {
      console.error('Failed to load venues:', err)
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

  function handleVenueSelect(venue: Venue) {
    trackEvent('venue_view', { deviceHash: getDeviceHash(), venueId: venue.id })
    setSelectedVenue(venue)
  }

  // Menu scan workflow
  async function handleCapture(files: File[], gps: { lat: number; lng: number } | null) {
    setScanFiles(files)
    setScanGps(gps)
    setScanStep('confirm')
    setScanLoading(true)
    setScanError('')

    try {
      // Step 1: Convert all files to base64 (with resize for large files)
      const { fileToBase64 } = await import('@/lib/imageResize')
      const imageDataUrls: string[] = []
      for (const file of files) {
        const dataUrl = await fileToBase64(file, 3) // max 3MB after base64 encoding
        imageDataUrls.push(dataUrl)
      }

      // Step 2: Find nearby venue by GPS
      let nearbyVenue: Venue | null = null
      if (gps) {
        const allVenues = await getVenuesByZip('97209')
        for (const v of allVenues) {
          if (!v.lat || !v.lng) continue
          const km = Math.sqrt(
            Math.pow((v.lat - gps.lat) * 111, 2) +
            Math.pow((v.lng - gps.lng) * 85, 2)
          )
          if (km < 0.05) { // ~50 meters
            nearbyVenue = v
            break
          }
        }
      }
      setMatchedVenue(nearbyVenue)

      // Step 3: Parse all pages (sends base64 directly — no Supabase URL needed)
      const texts: string[] = []
      for (let i = 0; i < imageDataUrls.length; i++) {
        console.log(`[PourList] Parsing page ${i+1}/${imageDataUrls.length}, size: ${imageDataUrls[i].length} chars`)
        const parseRes = await fetch('/api/parse-menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: imageDataUrls[i] })
        })

        if (parseRes.ok) {
          const data = await parseRes.json()
          console.log(`[PourList] Parse page ${i+1} result:`, data.text ? `got ${data.text.length} chars` : 'EMPTY — no text')
          if (data.text) texts.push(data.text)
          else console.warn('[PourList] Parse page returned no text field or empty text')
        } else {
          const errText = await parseRes.text()
          console.error(`[PourList] Parse page ${i+1} API error:`, parseRes.status, errText)
          // Surface the error to the user
          setScanError(`Page ${i+1} parse failed (${parseRes.status}): ${errText.slice(0, 200)}`)
        }
      }

      const combined = texts.join('\n\n--- Page ---\n\n')
      if (texts.length === 0) {
        await trackEvent('menu_parse_failure', { deviceHash: getDeviceHash() })
        setScanError('No menu text could be extracted. Please try again with better lighting or a clearer photo.')
        setParsedText('')
      } else {
        await trackEvent('menu_parse_success', { deviceHash: getDeviceHash(), metadata: { pageCount: texts.length } })
        setScanError('')
        setParsedText(combined)
      }

      // Step 4: HH screening
      const hh = checkHappyHour(combined)
      setIsNotHH(!hh.isHappyHour)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Something went wrong')
      setParsedText('[Could not extract menu text. Please try again.]')
    } finally {
      setScanLoading(false)
    }
  }

  async function handleMenuConfirm(menuText: string, venueId?: string) {
    setSubmitLoading(true)
    setSaveError('')
    setRateLimitError(null)

    // Client-side rate limit — fail fast before doing any work
    const deviceHash = getDeviceHash()
    const limit = checkRateLimit(deviceHash)
    if (!limit.allowed) {
      const s = Math.ceil((limit.retryAfterMs || 0) / 1000)
      setRateLimitError(`Slow down! Please wait ${s}s before submitting again.`)
      setSubmitLoading(false)
      return
    }

    try {
      // Step 1: Upload the first photo to Supabase Storage (reference image)
      let imageUrl: string | null = null
      if (scanFiles.length > 0) {
        const formData = new FormData()
        formData.append('photo', scanFiles[0])
        if (venueId) formData.append('venueId', venueId)
        if (scanGps) {
          formData.append('lat', String(scanGps.lat))
          formData.append('lng', String(scanGps.lng))
        }
        formData.append('deviceHash', deviceHash)

        try {
          const uploadRes = await fetch('/api/upload-photo', {
            method: 'POST',
            body: formData
          })
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json()
            imageUrl = uploadData.url
          } else {
            const errText = await uploadRes.text()
            console.error('Photo upload failed:', uploadRes.status, errText)
            // Non-fatal — continue without image
          }
        } catch (uploadErr) {
          console.error('Photo upload error:', uploadErr)
          // Non-fatal — continue without image
        }
      }

      // Step 2: Submit the menu
      const res = await fetch('/api/submit-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuText,
          venueId,
          venueName: matchedVenue?.name || 'Unknown Venue',
          address: matchedVenue?.address || '',
          lat: scanGps?.lat,
          lng: scanGps?.lng,
          deviceHash: deviceHash,
          imageUrl
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to save menu')
      }

      const { venueId: savedVenueId } = await res.json()

      // Refresh venues
      await loadVenues()
      await trackEvent('menu_save_success', { deviceHash, venueId: savedVenueId })

      // If we found a matched venue, refresh its detail view too
      if (matchedVenue) {
        setSelectedVenue(prev => prev ? { ...prev, menu_text: menuText, latest_menu_image_url: imageUrl || prev.latest_menu_image_url } : prev)
      }

      // Reset scan workflow
      setScanStep('idle')
      setScanFiles([])
      setScanGps(null)
      setParsedText('')
      setMatchedVenue(null)
      setIsDuplicate(false)
      setIsNotHH(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      await trackEvent('menu_save_failure', { deviceHash, metadata: { error: err instanceof Error ? err.message : 'unknown' } })
      setSaveError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    } finally {
      setSubmitLoading(false)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between shadow-md z-10">
        <div>
          <h1 className="text-lg font-bold tracking-tight">The Pour List</h1>
          <p className="text-amber-100 text-xs">Pearl District, Portland</p>
        </div>
        <button
          onClick={() => setShowAddVenue(true)}
          className="bg-white text-amber-600 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-amber-50 transition-colors"
        >
          + Add Venue
        </button>
      </header>

      {/* Radius selector */}
      <div className="shrink-0 px-4 py-2 bg-white border-b border-gray-100 flex items-center gap-2 overflow-x-auto">
        <span className="text-xs text-gray-400 shrink-0">Radius:</span>
        <div className="flex gap-1.5">
          {RADIUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRadius(opt.value)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                radius === opt.value
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-300 shrink-0 ml-auto">
          {venues.length} venues
        </span>
      </div>

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
                venues={venues}
                selectedVenue={selectedVenue}
                onVenueSelect={handleVenueSelect}
              />
            </div>
            <div className="hidden md:block w-80 bg-white border-l border-gray-200 overflow-y-auto">
              <VenueList
                venues={venues}
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

        {showAddVenue && (
          <AddVenueForm
            onClose={() => setShowAddVenue(false)}
            onVenueAdded={loadVenues}
          />
        )}
      </div>

      {/* Tip link + scan button */}
      <div className="shrink-0 p-4 bg-white border-t border-gray-100">
        {saveSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
            <span className="text-green-600 text-sm font-semibold">✓ Saved</span>
            <span className="text-sm text-green-700">
              {matchedVenue ? `${matchedVenue.name} menu updated` : 'New venue added'}
            </span>
          </div>
        )}
        {rateLimitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
            <span className="text-red-600 text-sm font-semibold">⏳ Hold on</span>
            <span className="text-sm text-red-700">{rateLimitError}</span>
          </div>
        )}

        {/* Tip developers link */}
        <button
          onClick={() => setSupportOpen(true)}
          className="w-full text-center text-xs text-gray-400 hover:text-amber-600 py-1 mb-2 transition-colors"
        >
          Enjoying your happy hour? Tip the developers $1 →
        </button>

        <button
          onClick={() => setScanStep('capture')}
          className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white py-4 px-6 rounded-2xl font-bold text-base shadow-lg flex items-center justify-center gap-3 transition-colors"
        >
          <span className="text-xl">📷</span>
          Scan Happy Hour Menu
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          Take a photo of a menu to add or update it
        </p>
      </div>

      {/* Menu scan workflow */}
      {scanStep === 'capture' && (
        <MenuCapture
          onCapture={handleCapture}
          onClose={() => setScanStep('idle')}
        />
      )}

      {scanStep === 'confirm' && scanFiles.length > 0 && (
        <MenuConfirm
          files={scanFiles}
          gps={scanGps}
          parsedText={parsedText}
          matchedVenue={matchedVenue}
          isDuplicate={isDuplicate}
          isNotHH={isNotHH}
          existingMenuText={matchedVenue?.menu_text}
          isLoading={submitLoading}
          isParsing={scanLoading}
          saveError={saveError}
            onRetry={() => handleMenuConfirm(parsedText, matchedVenue?.id)}
            onConfirm={handleMenuConfirm}
          onReject={() => {
            setScanStep('idle')
            setScanFiles([])
            setScanGps(null)
            setIsNotHH(false)
          }}
          onClose={() => {
            setScanStep('idle')
            setScanFiles([])
            setScanGps(null)
            setParsedText('')
            setMatchedVenue(null)
            setIsDuplicate(false)
            setIsNotHH(false)
            setSaveError('')
          }}
        />
      )}

      {onboardingOpen && (
        <OnboardingModal onClose={() => setOnboardingOpen(false)} />
      )}
    </div>
  )
}

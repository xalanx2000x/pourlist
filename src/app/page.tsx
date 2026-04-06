'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { getVenuesByZip } from '@/lib/venues'
import { fingerprintFile } from '@/lib/imageHash'
import type { Venue } from '@/lib/supabase'
import VenueList from '@/components/VenueList'
import VenueDetail from '@/components/VenueDetail'
import AddVenueForm from '@/components/AddVenueForm'
import MenuCapture from '@/components/MenuCapture'
import MenuConfirm from '@/components/MenuConfirm'
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

  // Menu scan workflow state
  const [scanStep, setScanStep] = useState<'idle' | 'capture' | 'confirm'>('idle')
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [scanGps, setScanGps] = useState<{ lat: number; lng: number } | null>(null)
  const [parsedText, setParsedText] = useState('')
  const [matchedVenue, setMatchedVenue] = useState<Venue | null>(null)
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')

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
    setSelectedVenue(venue)
  }

  // Menu scan workflow
  async function handleCapture(file: File, gps: { lat: number; lng: number } | null) {
    setScanFile(file)
    setScanGps(gps)
    setScanStep('confirm')
    setScanLoading(true)
    setScanError('')

    try {
      // Step 1: Upload photo first
      const formData = new FormData()
      formData.append('photo', file)
      formData.append('fingerprint', fingerprintFile(file))
      if (gps) {
        formData.append('lat', String(gps.lat))
        formData.append('lng', String(gps.lng))
      }

      const uploadRes = await fetch('/api/upload-photo', {
        method: 'POST',
        body: formData
      })

      if (!uploadRes.ok) {
        throw new Error('Failed to upload photo')
      }

      const { url: imageUrl, hash } = await uploadRes.json()

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

      // Step 3: Check for duplicate photo if we have a venue
      if (nearbyVenue && hash) {
        try {
          const dupRes = await fetch('/api/check-duplicate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venueId: nearbyVenue.id,
              photoHash: hash,
              fileSize: file.size
            })
          })
          const dupData = await dupRes.json()
          if (dupData.isDuplicate) {
            setIsDuplicate(true)
            setParsedText(dupData.existingMenuText || '[Existing menu on file]')
            setScanLoading(false)
            return
          }
        } catch {
          // Proceed without duplicate check
        }
      }

      // Step 4: Parse menu from uploaded image
      const parseRes = await fetch('/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl })
      })

      if (!parseRes.ok) {
        throw new Error('Failed to parse menu')
      }

      const { text } = await parseRes.json()
      setParsedText(text || '[No menu text extracted]')
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Something went wrong')
      setParsedText('[Could not extract menu text. Please try again.]')
    } finally {
      setScanLoading(false)
    }
  }

  async function handleMenuConfirm(menuText: string, venueId?: string) {
    try {
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
          deviceHash: 'anonymous'
        })
      })

      if (!res.ok) throw new Error('Failed to submit')

      // Refresh venues
      await loadVenues()
      setScanStep('idle')
      setScanFile(null)
      setScanGps(null)
      setParsedText('')
      setMatchedVenue(null)
      setIsDuplicate(false)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Failed to submit')
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
            onPhotoSubmitted={loadVenues}
          />
        )}

        {showAddVenue && (
          <AddVenueForm
            onClose={() => setShowAddVenue(false)}
            onVenueAdded={loadVenues}
          />
        )}
      </div>

      {/* Scan button — floating at bottom */}
      <div className="shrink-0 p-4 bg-white border-t border-gray-100">
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

      {scanStep === 'confirm' && scanFile && (
        <MenuConfirm
          file={scanFile}
          gps={scanGps}
          parsedText={parsedText}
          matchedVenue={matchedVenue}
          isDuplicate={isDuplicate}
          existingMenuText={matchedVenue?.menu_text}
          onConfirm={handleMenuConfirm}
          onReject={() => {
            setScanStep('idle')
            setScanFile(null)
            setScanGps(null)
          }}
          onClose={() => {
            setScanStep('idle')
            setScanFile(null)
            setScanGps(null)
            setParsedText('')
            setMatchedVenue(null)
            setIsDuplicate(false)
          }}
        />
      )}
    </div>
  )
}

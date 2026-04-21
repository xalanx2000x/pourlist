'use client'

import { useState, useEffect } from 'react'
import { getVenuesByProximity } from '@/lib/venues'
import { getBrowserLocation } from '@/lib/gps'
import type { Venue } from '@/lib/supabase'

interface ScanStartProps {
  onVenueSelected: (venue: Venue) => void
  onAddVenue: () => void
  onClose: () => void
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

type LocationStatus = 'loading' | 'denied' | 'error' | 'found'

export default function ScanStart({ onVenueSelected, onAddVenue, onClose }: ScanStartProps) {
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('loading')
  const [locationError, setLocationError] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])
  const [userGps, setUserGps] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLocationStatus('loading')
      setLocationError('')

      try {
        const gps = await getBrowserLocation()
        if (cancelled) return

        setUserGps(gps)

        // Find venues within 50m
        const nearby = await getVenuesByProximity(gps.lat, gps.lng, 50)
        if (cancelled) return

        // Sort by distance
        const sorted = nearby.sort((a, b) => {
          if (a.lat == null || a.lng == null) return 1
          if (b.lat == null || b.lng == null) return -1
          const da = haversineDistance(gps.lat, gps.lng, a.lat, a.lng)
          const db = haversineDistance(gps.lat, gps.lng, b.lat, b.lng)
          return da - db
        })

        setVenues(sorted)
        setLocationStatus('found')
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        if (message.includes('denied') || message.includes('permission')) {
          setLocationStatus('denied')
          setLocationError('Location permission is required to scan a menu.')
        } else {
          setLocationStatus('error')
          setLocationError('Could not get your location. Please try again.')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white text-sm font-medium"
        >
          ← Back
        </button>
        <span className="font-semibold text-sm">Scan Menu</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Loading state */}
        {locationStatus === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 text-sm">Finding your location...</p>
          </div>
        )}

        {/* Location denied */}
        {locationStatus === 'denied' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
            <span className="text-4xl">📍</span>
            <div>
              <p className="font-semibold text-gray-900 mb-1">Location Required</p>
              <p className="text-sm text-gray-500">{locationError}</p>
            </div>
            <p className="text-xs text-gray-400 max-w-xs">
              Please enable location permission in your browser settings, then try again.
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors"
            >
              Got it
            </button>
          </div>
        )}

        {/* Location error */}
        {locationStatus === 'error' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
            <span className="text-4xl">❌</span>
            <div>
              <p className="font-semibold text-gray-900 mb-1">Location Unavailable</p>
              <p className="text-sm text-gray-500">{locationError}</p>
            </div>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {/* Venues found — show list */}
        {locationStatus === 'found' && venues.length > 0 && userGps && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Are you at one of these venues?</h2>
            <p className="text-sm text-gray-500 mb-4">
              Select the venue below, then we'll scan the menu.
            </p>

            <div className="space-y-3">
              {venues.map((venue) => {
                const distance =
                  venue.lat != null && venue.lng != null
                    ? haversineDistance(userGps.lat, userGps.lng, venue.lat, venue.lng)
                    : null

                return (
                  <div
                    key={venue.id}
                    className="border border-gray-200 rounded-xl p-4 hover:border-amber-400 transition-colors cursor-pointer"
                    onClick={() => onVenueSelected(venue)}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl shrink-0">🏠</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{venue.name}</p>
                        {venue.address_backup && (
                          <p className="text-sm text-gray-500 truncate">{venue.address_backup}</p>
                        )}
                        {distance != null && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDistance(distance)} away
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3">
                      <button
                        onClick={() => onVenueSelected(venue)}
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg font-semibold text-sm transition-colors"
                      >
                        ✓ Yes, scan menu here
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* Divider + add new */}
              <div className="pt-2">
                <button
                  onClick={onAddVenue}
                  className="w-full border border-gray-300 border-dashed rounded-xl py-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
                >
                  + Add Happy Hour Location
                </button>
              </div>
            </div>
          </div>
        )}

        {/* No venues found — offer to add */}
        {locationStatus === 'found' && venues.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <span className="text-4xl">🏠</span>
            <div>
              <p className="font-semibold text-gray-900 mb-1">No Venues Nearby</p>
              <p className="text-sm text-gray-500">
                We couldn&apos;t find any registered venues within 50m of your location.
              </p>
            </div>
            <button
              onClick={onAddVenue}
              className="mt-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors"
            >
              + Add Happy Hour Location
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

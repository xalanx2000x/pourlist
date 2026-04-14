'use client'

import { useState, useEffect } from 'react'
import { getVenuesByProximity } from '@/lib/venues'
import type { Venue } from '@/lib/supabase'

interface VenuePickerProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  onVenueConfirmed: (venue: Venue) => void
  onVenueNotListed: () => void
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

export default function VenuePicker({
  files,
  gps,
  onVenueConfirmed,
  onVenueNotListed,
  onClose
}: VenuePickerProps) {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!gps) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    getVenuesByProximity(gps.lat, gps.lng, 10)
      .then((results) => {
        // Sort by distance to user
        const sorted = results.sort((a, b) => {
          if (a.lat == null || a.lng == null) return 1
          if (b.lat == null || b.lng == null) return -1
          const da = haversineDistance(gps.lat, gps.lng, a.lat, a.lng)
          const db = haversineDistance(gps.lat, gps.lng, b.lat, b.lng)
          return da - db
        })
        setVenues(sorted)

        // 0 nearby → immediately proceed to name entry
        if (sorted.length === 0) {
          onVenueNotListed()
        }
      })
      .catch((err) => {
        console.error('Venue proximity query failed:', err)
        setError('Could not find nearby venues.')
        // On error, proceed to name entry anyway
        onVenueNotListed()
      })
      .finally(() => {
        setLoading(false)
      })
  }, [gps, onVenueNotListed])

  // If loading, show spinner
  if (loading) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm mt-3">Finding nearby venues...</p>
      </div>
    )
  }

  // If 0 venues found (already called onVenueNotListed), show brief message
  if (venues.length === 0) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col items-center justify-center">
        <p className="text-gray-500 text-sm">No nearby venues found.</p>
      </div>
    )
  }

  const previewUrls = files.map(f => URL.createObjectURL(f))

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-white/80 hover:text-white text-sm font-medium">
          ✕
        </button>
        <span className="font-semibold text-sm">Confirm Venue</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Photo strip (read-only) */}
        {previewUrls.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
            {previewUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Menu page ${i + 1}`}
                className="h-16 w-auto object-contain rounded-xl bg-gray-100 shrink-0"
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>
        )}

        <h2 className="text-lg font-bold text-gray-900 mb-1">Are you at this venue?</h2>
        <p className="text-sm text-gray-500 mb-4">
          {venues.length === 1
            ? 'We found this venue near your location.'
            : `We found ${venues.length} venues near your location.`}
        </p>

        <div className="space-y-3">
          {venues.map((venue) => {
            const distance =
              venue.lat != null && venue.lng != null && gps
                ? haversineDistance(gps.lat, gps.lng, venue.lat, venue.lng)
                : null

            return (
              <div
                key={venue.id}
                className="border border-gray-200 rounded-xl p-4 hover:border-amber-400 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0">🏠</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{venue.name}</p>
                    {venue.address && (
                      <p className="text-sm text-gray-500 truncate">{venue.address}</p>
                    )}
                    {distance != null && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDistance(distance)} away
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onVenueConfirmed(venue)}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg font-semibold text-sm transition-colors"
                  >
                    ✓ Yes, that&apos;s me
                  </button>
                  <button
                    onClick={onVenueNotListed}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-lg font-medium text-sm transition-colors"
                  >
                    ✗ No, I&apos;m not here
                  </button>
                </div>
              </div>
            )
          })}

          {/* "None of these" option — only shown when multiple venues */}
          {venues.length > 1 && (
            <button
              onClick={onVenueNotListed}
              className="w-full border border-gray-300 border-dashed rounded-xl py-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
            >
              None of these
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

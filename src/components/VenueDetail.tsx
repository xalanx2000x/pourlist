'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Venue } from '@/lib/supabase'
import { hasActiveHappyHour } from '@/lib/activeHH'
import { getDeviceHash } from '@/lib/device'

type ActionState = 'idle' | 'loading' | 'success' | 'error'

interface VenueDetailProps {
  venue: Venue
  onClose: () => void
}

export default function VenueDetail({ venue, onClose }: VenueDetailProps) {
  const isActiveHH = hasActiveHappyHour(venue.menu_text)

  const [flagState, setFlagState] = useState<ActionState>('idle')
  const [confirmState, setConfirmState] = useState<ActionState>('idle')
  const [flagError, setFlagError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Request geolocation on mount (for flag button)
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLocationError('Location not available')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationError('Location unavailable')
    )
  }, [])

  const handleFlag = useCallback(async () => {
    if (!userLocation) {
      setFlagError('Need your location to flag — enable GPS')
      return
    }
    setFlagState('loading')
    setFlagError(null)

    try {
      const res = await fetch('/api/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          deviceHash: getDeviceHash(),
          reason: 'closed',
          lat: userLocation.lat,
          lng: userLocation.lng
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setFlagError(data.error || 'Failed to flag')
        setFlagState('error')
        return
      }
      setFlagState('success')
      setSuccessMessage('Reported — thanks for keeping it accurate')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setFlagError('Network error — try again')
      setFlagState('error')
    }
  }, [venue.id, userLocation])

  const handleConfirm = useCallback(async () => {
    if (!userLocation) {
      setConfirmError('Need your location to confirm — enable GPS')
      return
    }
    setConfirmState('loading')
    setConfirmError(null)

    try {
      const res = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          deviceHash: getDeviceHash(),
          lat: userLocation.lat,
          lng: userLocation.lng
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setConfirmError(data.error || 'Failed to confirm')
        setConfirmState('error')
        return
      }
      setConfirmState('success')
      setSuccessMessage('Venue confirmed — thanks')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setConfirmError('Network error — try again')
      setConfirmState('error')
    }
  }, [venue.id, userLocation])

  // Only show moderation buttons for verified/stale venues
  const showModeration = venue.status === 'verified' || venue.status === 'stale'

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto z-50">
      {/* Handle bar */}
      <div className="flex justify-center pt-3 pb-2">
        <div className="w-12 h-1 bg-gray-300 rounded-full" />
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200"
      >
        ✕
      </button>

      <div className="p-5">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-start gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-gray-900">{venue.name}</h2>
            {isActiveHH && (
              <span className="text-xs bg-purple-100 text-purple-700 px-2.5 py-0.5 rounded-full font-semibold mt-1">
                HH Active
              </span>
            )}
            {venue.status === 'unverified' && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full mt-1">
                New
              </span>
            )}
            {venue.status === 'stale' && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full mt-1">
                Needs Update
              </span>
            )}
          </div>
          <p className="text-gray-600 mt-1">{venue.address_backup}</p>
          {venue.phone && (
            <a href={`tel:${venue.phone}`} className="text-sm text-amber-600 hover:underline mt-1 block">
              {venue.phone}
            </a>
          )}
          {venue.website && (
            <a href={venue.website} target="_blank" rel="noopener noreferrer" className="text-sm text-amber-600 hover:underline mt-1 block">
              Visit website →
            </a>
          )}
        </div>

        {/* Type badge */}
        {venue.type && (
          <span className="inline-block text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full mb-4">
            {venue.type}
          </span>
        )}

        {/* Success message */}
        {successMessage && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2.5 rounded-xl">
            ✅ {successMessage}
          </div>
        )}

        {/* Moderation buttons */}
        {showModeration && (
          <div className="mb-5 border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3">See something wrong?</p>
            <div className="flex gap-2">
              {/* Flag button */}
              <button
                onClick={handleFlag}
                disabled={flagState === 'loading' || flagState === 'success' || !userLocation}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                  flagState === 'success'
                    ? 'bg-green-100 text-green-700'
                    : flagState === 'loading'
                    ? 'bg-gray-100 text-gray-400'
                    : 'bg-red-50 hover:bg-red-100 text-red-700'
                }`}
                title={!userLocation ? 'Enable location to flag' : undefined}
              >
                {flagState === 'loading' ? (
                  <span className="text-xs">Sending…</span>
                ) : flagState === 'success' ? (
                  <>Reported ✓</>
                ) : (
                  <>🚫 This place is closed</>
                )}
              </button>

              {/* Confirm button */}
              <button
                onClick={handleConfirm}
                disabled={confirmState === 'loading' || confirmState === 'success'}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                  confirmState === 'success'
                    ? 'bg-green-100 text-green-700'
                    : confirmState === 'loading'
                    ? 'bg-gray-100 text-gray-400'
                    : 'bg-green-50 hover:bg-green-100 text-green-700'
                }`}
              >
                {confirmState === 'loading' ? (
                  <span className="text-xs">Sending…</span>
                ) : confirmState === 'success' ? (
                  <>Confirmed ✓</>
                ) : (
                  <>👍 Menu looks right</>
                )}
              </button>
            </div>

            {/* Error messages */}
            {(flagError || confirmError) && (
              <p className="text-xs text-red-600 mt-2">
                {flagError || confirmError}
              </p>
            )}

            {/* Location note */}
            {!userLocation && !locationError && (
              <p className="text-xs text-gray-400 mt-2">
                📍 Getting your location…
              </p>
            )}
            {locationError && (
              <p className="text-xs text-gray-400 mt-2">
                {locationError} — flagging requires GPS
              </p>
            )}
          </div>
        )}

        {/* Menu image */}
        {venue.latest_menu_image_url && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Menu Photo</h3>
              <span className="text-xs text-gray-400">Reference</span>
            </div>
            <a
              href={venue.latest_menu_image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl overflow-hidden border border-gray-200 hover:border-amber-400 transition-colors"
            >
              <img
                src={venue.latest_menu_image_url}
                alt="Happy hour menu"
                className="w-full max-h-52 object-contain bg-gray-50"
              />
            </a>
          </div>
        )}

        {/* Menu text */}
        {venue.menu_text ? (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Happy Hour Menu</h3>
              <span className="text-xs text-gray-400">
                {venue.menu_text_updated_at
                  ? `Updated ${new Date(venue.menu_text_updated_at).toLocaleDateString()}`
                  : ''}
              </span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
              {venue.menu_text}
            </div>
          </div>
        ) : (
          <div className="mb-5">
            <p className="text-sm text-gray-400 italic text-center py-3 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              No menu on file yet. Be the first to scan it!
            </p>
          </div>
        )}

        {/* Google/Yelp links */}
        <div className="flex gap-3 mb-5">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ' ' + (venue.address_backup || ''))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            📍 Directions
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ' ' + (venue.address_backup || ''))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-amber-100 hover:bg-amber-200 text-amber-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            ⭐ on Google
          </a>
        </div>

        {/* Scan call-to-action */}
        <p className="text-xs text-gray-400 text-center">
          Tap "Scan Happy Hour Menu" at the bottom to add or update menu info
        </p>
      </div>
    </div>
  )
}

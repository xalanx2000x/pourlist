'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Venue } from '@/lib/supabase'

interface NameEntryProps {
  gps: { lat: number; lng: number } | null
  onVenueMatched: (venue: Venue) => void
  onVenueCreated: (name: string) => void
  onClose: () => void
}

interface VenueSuggestion {
  venue: Venue
  distance: number | null
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

const PORTLAND_CENTER = { lat: 45.523, lng: -122.676 }

export default function NameEntry({
  gps,
  onVenueMatched,
  onVenueCreated,
  onClose
}: NameEntryProps) {
  const [name, setName] = useState('')
  const [suggestion, setSuggestion] = useState<VenueSuggestion | null>(null)
  const [showSuggestion, setShowSuggestion] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const searchRadiusKm = 5 // ~5km radius for fuzzy match

  const searchVenues = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setSuggestion(null)
        setShowSuggestion(false)
        return
      }

      setLoading(true)
      try {
        // Fuzzy search on name
        const { data, error } = await supabase
          .from('venues')
          .select('id, name, address_backup, lat, lng')
          .ilike('name', `%${query}%`)
          .not('lat', 'is', null)
          .not('lng', 'is', null)
          .limit(10)

        if (error || !data) {
          setSuggestion(null)
          setShowSuggestion(false)
          return
        }

        const effectiveGps = gps || PORTLAND_CENTER

        // Filter by distance and sort by proximity
        const withDistance: VenueSuggestion[] = (data as Venue[])
          .map((venue) => ({
            venue,
            distance:
              venue.lat != null && venue.lng != null
                ? haversineDistance(effectiveGps.lat, effectiveGps.lng, venue.lat, venue.lng)
                : null
          }))
          .filter((s) => s.distance !== null && s.distance <= searchRadiusKm * 1000)
          .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))

        if (withDistance.length > 0) {
          setSuggestion(withDistance[0])
          setShowSuggestion(true)
        } else {
          setSuggestion(null)
          setShowSuggestion(false)
        }
      } catch {
        setSuggestion(null)
        setShowSuggestion(false)
      } finally {
        setLoading(false)
      }
    },
    [gps]
  )

  // Debounced search on name change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!dismissed) {
        searchVenues(name)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [name, dismissed, searchVenues])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSuggestionYes() {
    if (suggestion) {
      onVenueMatched(suggestion.venue)
    }
  }

  function handleSuggestionNo() {
    setDismissed(true)
    setShowSuggestion(false)
    setSuggestion(null)
  }

  function handleCreate() {
    if (!name.trim()) return
    setIsCreating(true)
    onVenueCreated(name.trim())
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && name.trim().length >= 2) {
      handleCreate()
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-white/80 hover:text-white text-sm font-medium">
          Back
        </button>
        <span className="font-semibold text-sm">New Venue</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-xl font-bold text-gray-900 mb-1">New venue</h2>
        <p className="text-sm text-gray-500 mb-4">
          What&apos;s the venue called?
        </p>

        {/* Name input */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Venue Name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setDismissed(false)
            }}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Jolly Roger, Bao Bar"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {/* Loading indicator while searching */}
        {loading && name.length >= 2 && (
          <p className="text-xs text-gray-400 mb-3">Searching...</p>
        )}

        {/* "Did you mean?" suggestion */}
        {showSuggestion && suggestion && (
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Did you mean?</p>
            <div className="border border-amber-300 bg-amber-50 rounded-xl p-4">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-xl shrink-0">🏠</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {suggestion.venue.name}
                  </p>
                  {suggestion.venue.address_backup && (
                    <p className="text-sm text-gray-500 truncate">
                      {suggestion.venue.address_backup}
                    </p>
                  )}
                  {suggestion.distance != null && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDistance(suggestion.distance)} away
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSuggestionYes}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg font-semibold text-sm transition-colors"
                >
                  Yes
                </button>
                <button
                  onClick={handleSuggestionNo}
                  className="flex-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 py-2 rounded-lg font-medium text-sm transition-colors"
                >
                  No
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Separator */}
        {showSuggestion && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
        )}

        {/* Create button — always visible as fallback */}
        {name.trim().length >= 2 && (
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="w-full bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>Create &ldquo;{name.trim()}&rdquo;</>
            )}
          </button>
        )}

        {name.trim().length < 2 && (
          <p className="text-sm text-gray-400 text-center py-4">
            Keep typing to search for an existing venue...
          </p>
        )}
      </div>
    </div>
  )
}

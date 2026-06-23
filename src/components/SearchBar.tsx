'use client'

import { useState, useRef, useCallback } from 'react'
import { searchVenues, type GeoResult } from '@/lib/geocode'
import type { Venue } from '@/lib/supabase'
import { formatAddress } from '@/lib/format-address'
import { hasHappyHourData } from '@/lib/happy-hour-data'
import { trackEvent } from '@/lib/analytics'
import { getDeviceHash } from '@/lib/device'

interface SearchBarProps {
  onSearch: (coords: { lat: number; lng: number }, meta: {
    query: string
    queryType: 'venue' | 'location'
    resultCount: number
    resultVenueIds: string[]
    searchArea: string
  }) => void
  onVenueSelect: (venue: Venue) => void
  onClear: () => void
}

export default function SearchBar({ onSearch, onVenueSelect, onClear }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [venueResults, setVenueResults] = useState<Venue[]>([])
  const [geoResult, setGeoResult] = useState<GeoResult | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preUserValueRef = useRef<string>('')
  const isFirstChangeRef = useRef(false)
  // Stores the last search result so handleGeoClick can read it after doSearch resolves
  const lastSearchMetaRef = useRef<{
    query: string
    queryType: 'venue' | 'location'
    resultCount: number
    resultVenueIds: string[]
    searchArea: string
  }>({ query: '', queryType: 'location', resultCount: 0, resultVenueIds: [], searchArea: '' })

  async function doSearch(q: string) {
    if (!q.trim()) {
      setVenueResults([])
      setGeoResult(null)
      setShowDropdown(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setShowDropdown(false)
    setVenueResults([])
    setGeoResult(null)

    const result = await searchVenues(q)
    setLoading(false)

    // Store result metadata in a ref so handleGeoClick can read it after state updates
    lastSearchMetaRef.current = {
      query: q,
      queryType: 'location',
      resultCount: result.venues.length,
      resultVenueIds: result.venues.map(v => v.id),
      searchArea: result.geo?.displayName ?? '',
    }

    // Fire search event — results OR zero-result, debounced to committed search
    trackEvent('search', {
      deviceHash: getDeviceHash(),
      metadata: {
        query: q,
        queryType: 'location',
        resultCount: result.venues.length,
        resultVenueIds: result.venues.map(v => v.id),
        searchArea: result.geo?.displayName ?? '',
      },
    })

    // Both surfaces always come back — show a single dropdown with
    // two labeled sections (Venues / Places). Only fall back to the
    // "no matches" error when BOTH sides are empty.
    setVenueResults(result.venues)
    setGeoResult(result.geo)
    if (result.venues.length === 0 && !result.geo) {
      showError('No matches.')
    } else {
      setShowDropdown(true)
    }
  }

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (errorTimer.current) clearTimeout(errorTimer.current)

    if (isFirstChangeRef.current) {
      if (val !== preUserValueRef.current) {
        preUserValueRef.current = val
      }
      isFirstChangeRef.current = false
      return
    }

    if (!val.trim()) {
      setVenueResults([])
      setGeoResult(null)
      setShowDropdown(false)
      setLoading(false)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      return
    }

    preUserValueRef.current = val
    isFirstChangeRef.current = false

    if (val.trim().length < 2) {
      setLoading(false)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      return
    }

    setLoading(true)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => doSearch(val), 500)
  }, [])

  function showError(msg: string) {
    setError(msg)
    setVenueResults([])
    setGeoResult(null)
    setShowDropdown(false)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(''), 3000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    const trimmed = query.trim()
    if (!trimmed) return
    await doSearch(trimmed)
  }

  function handleVenueClick(venue: Venue) {
    // Capture metadata before state clears
    const meta = { ...lastSearchMetaRef.current }
    // Update queryType since this is a venue-selection path
    meta.queryType = 'venue'
    meta.resultCount = 1
    meta.resultVenueIds = [venue.id]

    setShowDropdown(false)
    setVenueResults([])
    setGeoResult(null)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    onVenueSelect(venue)

    // Fire venue_select event (click-through funnel — separate from the search event)
    setTimeout(() => {
      trackEvent('venue_select', {
        deviceHash: getDeviceHash(),
        metadata: {
          query: meta.query,
          queryType: meta.queryType,
          resultCount: meta.resultCount,
          resultVenueIds: meta.resultVenueIds,
          selectedVenueId: venue.id,
          searchArea: meta.searchArea,
        },
      })
    }, 0)
  }

  function handleGeoClick() {
    if (!geoResult) return
    const meta = { ...lastSearchMetaRef.current }
    setShowDropdown(false)
    setVenueResults([])
    setGeoResult(null)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    onSearch({ lat: geoResult.lat, lng: geoResult.lng }, meta)
  }

  function handleClear() {
    setQuery('')
    setError('')
    setVenueResults([])
    setGeoResult(null)
    setShowDropdown(false)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    onClear()
  }

  const showVenues = showDropdown && venueResults.length > 0
  const showGeo = showDropdown && geoResult

  return (
    <div className="shrink-0 px-4 py-2 bg-white border-b border-gray-100">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute left-3 text-gray-400 hover:text-amber-600 disabled:opacity-40 transition-colors z-10"
          aria-label="Search"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" strokeWidth="2" />
              <path strokeWidth="2" strokeLinecap="round" d="m16.5 16.5 4 4" />
            </svg>
          )}
        </button>

        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => { isFirstChangeRef.current = true }}
          placeholder="Search venue or location..."
          autoComplete="off"
          className="w-full pl-9 pr-16 py-2 bg-amber-50 border border-amber-200 rounded-xl text-sm text-gray-800 placeholder-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
        />

        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-12 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth="2" />
              <path strokeWidth="2" strokeLinecap="round" d="M9 9l6 6M15 9l-6 6" />
            </svg>
          </button>
        )}
      </form>

      {/* Single dropdown with two labeled sections.
          - Venues on top (verified bubble up via searchVenues ranking)
          - Places below (single Nominatim hit, if any) */}
      {(showVenues || showGeo) && (
        <div className="absolute z-50 w-[calc(100%-2rem)] mt-1 bg-white border border-amber-200 rounded-xl shadow-lg overflow-hidden">
          {showVenues && (
            <div>
              <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Venues
              </div>
              {venueResults.map(venue => {
                const verified = hasHappyHourData(venue)
                return (
                  <button
                    key={venue.id}
                    onClick={() => handleVenueClick(venue)}
                    className="w-full text-left px-4 py-3 hover:bg-amber-50 border-b border-gray-100 last:border-b-0 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800 truncate">{venue.name}</p>
                      {!verified && (
                        <span className="shrink-0 text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
                          Unverified happy hour
                        </span>
                      )}
                    </div>
                    {formatAddress(venue) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatAddress(venue)}</p>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {showGeo && (
            <div>
              {showVenues && (
                <div className="border-t border-gray-100" />
              )}
              <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Places
              </div>
              <button
                onClick={handleGeoClick}
                className="w-full text-left px-4 py-3 hover:bg-amber-50 transition-colors"
              >
                <p className="text-sm text-gray-700">
                  <span className="mr-1.5">📍</span>
                  {geoResult!.displayName}
                </p>
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-red-500 text-xs mt-1 pl-1">{error}</p>
      )}
    </div>
  )
}

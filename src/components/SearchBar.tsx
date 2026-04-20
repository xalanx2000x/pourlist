'use client'

import { useState, useRef, useCallback } from 'react'
import { searchVenues } from '@/lib/geocode'
import type { Venue } from '@/lib/supabase'

interface SearchBarProps {
  onSearch: (coords: { lat: number; lng: number }) => void
  onVenueSelect: (venue: Venue) => void
  onClear: () => void
}

export default function SearchBar({ onSearch, onVenueSelect, onClear }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [venueResults, setVenueResults] = useState<Venue[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function doSearch(q: string) {
    if (!q.trim()) {
      setVenueResults([])
      setShowDropdown(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setShowDropdown(false)
    setVenueResults([])

    const result = await searchVenues(q)
    setLoading(false)

    if (result.type === 'venues' && result.venues) {
      setVenueResults(result.venues)
      setShowDropdown(true)
    } else if (result.type === 'location' && result.coords) {
      setShowDropdown(false)
      onSearch(result.coords)
    } else {
      showError('Location not found. Try a different city or zip.')
    }
  }

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (errorTimer.current) clearTimeout(errorTimer.current)

    if (!val.trim()) {
      setVenueResults([])
      setShowDropdown(false)
      setLoading(false)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      return
    }

    setLoading(true)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => doSearch(val), 350)
  }, [])

  function showError(msg: string) {
    setError(msg)
    setVenueResults([])
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
    setShowDropdown(false)
    setVenueResults([])
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    onVenueSelect(venue)
  }

  function handleClear() {
    setQuery('')
    setError('')
    setVenueResults([])
    setShowDropdown(false)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    onClear()
  }

  return (
    <div className="shrink-0 px-4 py-2 bg-white border-b border-gray-100">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        {/* Search icon / button */}
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

      {/* Venue results dropdown — appears above input */}
      {showDropdown && venueResults.length > 0 && (
        <div className="absolute z-50 w-[calc(100%-2rem)] mt-1 bg-white border border-amber-200 rounded-xl shadow-lg overflow-hidden">
          {venueResults.map(venue => (
            <button
              key={venue.id}
              onClick={() => handleVenueClick(venue)}
              className="w-full text-left px-4 py-3 hover:bg-amber-50 border-b border-gray-100 last:border-b-0 transition-colors"
            >
              <p className="text-sm font-medium text-gray-800">{venue.name}</p>
              {venue.address_backup && (
                <p className="text-xs text-gray-500 mt-0.5">{venue.address_backup}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-red-500 text-xs mt-1 pl-1">{error}</p>
      )}
    </div>
  )
}

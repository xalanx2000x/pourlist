'use client'

import { useState, useRef } from 'react'
import { geocodeLocation } from '@/lib/geocode'

interface SearchBarProps {
  onSearch: (coords: { lat: number; lng: number }) => void
  onClear: () => void
}

export default function SearchBar({ onSearch, onClear }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showError(msg: string) {
    setError(msg)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(''), 3000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setLoading(true)
    const result = await geocodeLocation(trimmed)
    setLoading(false)
    if (!result) {
      showError('Location not found. Try a different city or zip.')
      return
    }
    onSearch(result)
  }

  function handleClear() {
    setQuery('')
    setError('')
    if (errorTimer.current) clearTimeout(errorTimer.current)
    onClear()
  }

  return (
    <div className="shrink-0 px-4 py-2 bg-white border-b border-gray-100">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        {/* Search icon / button */}
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute left-3 text-gray-400 hover:text-amber-600 disabled:opacity-40 transition-colors"
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
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a city or zip..."
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

      {error && (
        <p className="text-red-500 text-xs mt-1 pl-1">{error}</p>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { getVenuesByZip } from '@/lib/venues'
import type { Venue } from '@/lib/supabase'
import VenueList from '@/components/VenueList'
import VenueDetail from '@/components/VenueDetail'
import AddVenueForm from '@/components/AddVenueForm'

// Dynamic import for Map to avoid SSR issues with Mapbox
const Map = dynamic(() => import('@/components/Map'), { ssr: false })

type ViewMode = 'map' | 'list'

export default function Home() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [showAddVenue, setShowAddVenue] = useState(false)

  const loadVenues = useCallback(async () => {
    try {
      const data = await getVenuesByZip('97209')
      setVenues(data)
    } catch (err) {
      console.error('Failed to load venues:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVenues()
  }, [loadVenues])

  function handleVenueSelect(venue: Venue) {
    setSelectedVenue(venue)
    // On mobile, switch to detail view
    if (window.innerWidth < 768) {
      setViewMode('list')
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
            {/* Floating venue list on map view */}
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

        {/* Venue detail panel */}
        {selectedVenue && (
          <VenueDetail
            venue={selectedVenue}
            onClose={() => setSelectedVenue(null)}
            onPhotoSubmitted={loadVenues}
          />
        )}

        {/* Add venue panel */}
        {showAddVenue && (
          <AddVenueForm
            onClose={() => setShowAddVenue(false)}
            onVenueAdded={loadVenues}
          />
        )}
      </div>
    </div>
  )
}

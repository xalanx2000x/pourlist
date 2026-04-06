'use client'

import type { Venue } from '@/lib/supabase'

interface VenueCardProps {
  venue: Venue
  isSelected: boolean
  onClick: () => void
}

export default function VenueCard({ venue, isSelected, onClick }: VenueCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 border-b border-gray-100 transition-colors ${
        isSelected ? 'bg-amber-50 border-l-4 border-l-amber-500' : 'hover:bg-gray-50 border-l-4 border-l-transparent'
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{venue.name}</h3>
          <p className="text-sm text-gray-600 mt-0.5">{venue.address}</p>
          {venue.type && (
            <span className="inline-block mt-1.5 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {venue.type}
            </span>
          )}
        </div>
        {venue.status === 'unverified' && (
          <span className="shrink-0 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
            New
          </span>
        )}
        {venue.status === 'stale' && (
          <span className="shrink-0 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
            Needs Update
          </span>
        )}
      </div>
    </button>
  )
}

'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'
import { getVenuePhotos, submitPhoto } from '@/lib/venues'
import { getDeviceHash } from '@/lib/device'

interface VenueDetailProps {
  venue: Venue
  onClose: () => void
  onPhotoSubmitted: () => void
}

export default function VenueDetail({ venue, onClose, onPhotoSubmitted }: VenueDetailProps) {
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setMessage('')

    try {
      const deviceHash = getDeviceHash()
      
      // In a real app, you'd upload to Supabase Storage here
      // For now, we'll create a local object URL as a placeholder
      const photoUrl = URL.createObjectURL(file)

      await submitPhoto(photoUrl, venue.id, deviceHash)
      setMessage('Photo submitted! It will appear after review.')
      setShowUpload(false)
      onPhotoSubmitted()
    } catch (err) {
      setMessage('Failed to submit photo. Please try again.')
    } finally {
      setUploading(false)
    }
  }

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
          <div className="flex items-start gap-2">
            <h2 className="text-xl font-bold text-gray-900">{venue.name}</h2>
            {venue.status === 'unverified' && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full mt-1">
                New
              </span>
            )}
          </div>
          <p className="text-gray-600 mt-1">{venue.address}</p>
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
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ' ' + venue.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            📍 Directions
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ' ' + venue.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-amber-100 hover:bg-amber-200 text-amber-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            ⭐ on Google
          </a>
        </div>

        {/* Upload photo section */}
        {!showUpload ? (
          <button
            onClick={() => setShowUpload(true)}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 px-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <span>📷</span>
            Upload Happy Hour Menu Photo
          </button>
        ) : (
          <div className="border-2 border-dashed border-amber-300 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-600 mb-3">
              Take a clear photo of the happy hour menu or board.
            </p>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*,image/heic,image/heif,image/heif-compressed"
                capture="environment"
                onChange={handlePhotoUpload}
                disabled={uploading}
                className="hidden"
              />
              <span className="inline-block bg-amber-500 hover:bg-amber-600 text-white py-2.5 px-6 rounded-lg font-semibold transition-colors">
                {uploading ? 'Uploading...' : 'Choose Photo'}
              </span>
            </label>
            {message && (
              <p className={`text-sm mt-3 ${message.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </p>
            )}
          </div>
        )}

        {/* Help text */}
        <p className="text-xs text-gray-400 mt-3 text-center">
          Photos are reviewed before appearing publicly.
        </p>
      </div>
    </div>
  )
}

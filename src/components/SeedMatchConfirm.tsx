'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'

interface SeedMatchConfirmProps {
  seedVenue: Venue
  files: File[]
  onConfirm: (venue: Venue) => Promise<void>
  onDeny: () => void
  onClose: () => void
}

export default function SeedMatchConfirm({
  seedVenue,
  files,
  onConfirm,
  onDeny,
  onClose,
}: SeedMatchConfirmProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const previewUrls = files.map(f => URL.createObjectURL(f))

  async function handleConfirm() {
    setLoading(true)
    setError('')
    try {
      await onConfirm(seedVenue)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-white/80 hover:text-white text-sm font-medium">
          ← Back
        </button>
        <span className="font-semibold text-sm">Venue Found</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Photo strip */}
        {previewUrls.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {previewUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Menu photo ${i + 1}`}
                className="h-20 w-auto object-contain rounded-xl bg-gray-100 shrink-0"
              />
            ))}
          </div>
        )}

        {/* Match prompt */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
          <p className="text-3xl mb-3">🏠</p>
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            Did you mean &ldquo;{seedVenue.name}&rdquo;?
          </h2>
          {seedVenue.address && (
            <p className="text-sm text-gray-500">{seedVenue.address}</p>
          )}
          <p className="text-xs text-amber-700 mt-2">
            This venue is in our database and needs a photo to go live.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <p className="text-sm font-medium text-red-700">Failed</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
        )}

        {/* Info */}
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-sm text-gray-600">
            <strong>Yes</strong> — upload your photo to this venue. It will become visible to everyone.
          </p>
          <p className="text-sm text-gray-600 mt-2">
            <strong>No</strong> — enter a different venue name. Your photo will create a new listing.
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="shrink-0 p-4 border-t border-gray-100 bg-white space-y-2">
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>✓ Yes — add photo to &ldquo;{seedVenue.name}&rdquo;</>
          )}
        </button>
        <button
          onClick={onDeny}
          disabled={loading}
          className="w-full text-center text-sm text-gray-500 hover:text-gray-700 py-2 transition-colors disabled:opacity-50"
        >
          No — enter a different venue
        </button>
      </div>
    </div>
  )
}
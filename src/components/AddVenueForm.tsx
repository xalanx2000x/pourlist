'use client'

import { useState } from 'react'
import { createVenueForScan } from '@/lib/venues'
import { getDeviceHash } from '@/lib/device'
import type { Venue } from '@/lib/supabase'

interface AddVenueFormProps {
  onClose: () => void
  onVenueAdded?: () => void
  initialCoords?: { lat: number; lng: number }
  onVenueCreated?: (venue: Venue) => void
}

/**
 * Simplified AddVenueForm for the "manually add a venue" case (accessible from map screen).
 * Only collects the venue name. GPS from initialCoords is stored if available.
 * No geocoding, no phone/website/type fields.
 */
export default function AddVenueForm({
  onClose,
  onVenueAdded,
  initialCoords,
  onVenueCreated
}: AddVenueFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError('')

    try {
      const deviceHash = getDeviceHash()
      const newVenue = await createVenueForScan({
        name: name.trim(),
        lat: initialCoords?.lat ?? null,
        lng: initialCoords?.lng ?? null,
        address: null,
        deviceHash
      })

      onVenueAdded?.()
      if (onVenueCreated) onVenueCreated(newVenue)
      onClose()
    } catch (err) {
      console.error('AddVenueForm: failed to create venue', err)
      setError('Could not add venue. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto z-50">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>

        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200"
          aria-label="Close"
        >
          ✕
        </button>

        <form onSubmit={handleSubmit} className="p-5">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Add a Venue</h2>
          <p className="text-sm text-gray-500 mb-4">
            Enter the venue name. You can add a menu photo next.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-4">
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Venue Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
              placeholder="The Triple Lindy"
              autoFocus
            />
          </div>

          {initialCoords && (
            <p className="text-xs text-gray-400 mb-4">
              📍 Location will be saved from your current GPS position.
            </p>
          )}

          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Adding...
              </>
            ) : (
              'Add Venue'
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-3">
            Tip: Scan a menu photo instead — it&apos;s faster and pins the location automatically.
          </p>
        </form>
      </div>
    </>
  )
}

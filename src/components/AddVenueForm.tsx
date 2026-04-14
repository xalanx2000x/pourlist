'use client'

import { useState } from 'react'
import { addVenue } from '@/lib/venues'
import { getDeviceHash, reverseGeocode } from '@/lib/device'

interface AddVenueFormProps {
  onClose: () => void
  onVenueAdded: () => void
  initialCoords?: { lat: number; lng: number }
  onVenueCreated?: (venue: { id: string; name: string; address: string }) => void
}

export default function AddVenueForm({ onClose, onVenueAdded, initialCoords, onVenueCreated }: AddVenueFormProps) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    website: '',
    type: ''
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const deviceHash = getDeviceHash()
      let lat = initialCoords?.lat
      let lng = initialCoords?.lng

      // If we have coords but no address, try to reverse geocode
      if (lat && lng && !form.address) {
        const address = await reverseGeocode(lat, lng)
        if (address) {
          setForm(f => ({ ...f, address }))
        }
      }

      const newVenue = await addVenue({
        name: form.name,
        address: form.address,
        phone: form.phone || null,
        website: form.website || null,
        type: form.type || null,
        zip: '97209',
        lat: lat || null,
        lng: lng || null,
        status: 'unverified',
        contributor_trust: 'new'
      })

      setMessage('Venue added! It will appear after review.')
      setTimeout(() => {
        onVenueAdded()
        if (onVenueCreated) onVenueCreated(newVenue)
        onClose()
      }, 1500)
    } catch (err) {
      setMessage('Failed to add venue. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Dark overlay behind the form */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Form sheet */}
      <div className="fixed inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto z-50">
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 active:bg-gray-300"
          aria-label="Close"
        >
          ✕
        </button>

        <form onSubmit={handleSubmit} className="p-5">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Add a New Venue</h2>

          <p className="text-sm text-gray-500 mb-4">
            Can't find a bar? Add it here. Our team will verify the details.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Venue Name *
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="The Triple Lindy"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address *
              </label>
              <input
                type="text"
                required
                value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="1000 NW 17th Ave"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="(503) 555-0100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Website
              </label>
              <input
                type="url"
                value={form.website}
                onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="https://example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
              >
                <option value="">Select type...</option>
                <option value="Bar">Bar</option>
                <option value="Restaurant">Restaurant</option>
                <option value="Cocktail Lounge">Cocktail Lounge</option>
                <option value="Sports Bar">Sports Bar</option>
                <option value="Dive Bar">Dive Bar</option>
                <option value="Brewpub">Brewpub</option>
                <option value="Wine Bar">Wine Bar</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          {message && (
            <p className={`text-sm mt-4 ${message.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white py-3 px-4 rounded-lg font-semibold transition-colors"
          >
            {loading ? 'Adding...' : 'Add Venue'}
          </button>
        </form>
      </div>
    </>
  )
}

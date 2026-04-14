'use client'

import { useState } from 'react'
import { addVenue } from '@/lib/venues'
import { getDeviceHash, reverseGeocode } from '@/lib/device'
import { geocodeAddress } from '@/lib/geocode'

type GeocodeStatus = 'idle' | 'resolving' | 'found' | 'not-found' | 'error'

interface AddVenueFormProps {
  onClose: () => void
  onVenueAdded: () => void
  initialCoords?: { lat: number; lng: number }
  onVenueCreated?: (venue: { id: string; name: string; address: string; lat: number | null; lng: number | null; status: string }) => void
}

export default function AddVenueForm({ onClose, onVenueAdded, initialCoords, onVenueCreated }: AddVenueFormProps) {
  const [loading, setLoading] = useState(false)
  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus>('idle')
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    address: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const deviceHash = getDeviceHash()
    let lat = initialCoords?.lat
    let lng = initialCoords?.lng
    let zip: string | null = null

    // If we have GPS but no address, reverse geocode to fill address
    if (lat && lng && !form.address) {
      const address = await reverseGeocode(lat, lng)
      if (address) {
        setForm(f => ({ ...f, address }))
        setResolvedAddress(address)
      }
    }

    // If we have address but no GPS, forward geocode
    if (!lat && !lng && form.address) {
      setGeocodeStatus('resolving')
      const geo = await geocodeAddress(form.address)
      if (geo) {
        lat = geo.lat
        lng = geo.lng
        zip = geo.zip || null
        setResolvedAddress(geo.zip ? `${form.address}, Portland, OR ${geo.zip}` : `${form.address}, Portland, OR`)
        setGeocodeStatus('found')
      } else {
        setGeocodeStatus('not-found')
        setLoading(false)
        return
      }
    } else if (lat && lng) {
      // GPS available — use it directly, resolve address if not set
      if (!form.address) {
        const address = await reverseGeocode(lat, lng)
        if (address) {
          setForm(f => ({ ...f, address }))
          setResolvedAddress(address)
        }
      }
      setGeocodeStatus('found')
    }

    try {
      const newVenue = await addVenue({
        name: form.name,
        address: form.address || resolvedAddress || '',
        phone: null,
        website: null,
        type: null,
        zip: zip || '97209',
        lat: lat || null,
        lng: lng || null,
        status: 'unverified',
        contributor_trust: 'new'
      })

      onVenueAdded()
      if (onVenueCreated) onVenueCreated(newVenue)
      onClose()
    } catch (err) {
      setGeocodeStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = form.name.trim() && form.address.trim() && !loading

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <div className="fixed inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto z-50">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-gray-300 rounded-full" />
        </div>

        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 active:bg-gray-300"
          aria-label="Close"
        >
          ✕
        </button>

        <form onSubmit={handleSubmit} className="p-5">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Add a Venue</h2>
          <p className="text-sm text-gray-500 mb-4">
            Just the name and address — we'll find it on the map.
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
                onChange={e => {
                  setForm(f => ({ ...f, address: e.target.value }))
                  setGeocodeStatus('idle')
                  setResolvedAddress(null)
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                placeholder="5627 S Kelly Ave, Portland, OR"
              />
            </div>

            {/* Geocode feedback */}
            {geocodeStatus === 'resolving' && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                </svg>
                Finding location...
              </div>
            )}

            {geocodeStatus === 'found' && resolvedAddress && (
              <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                <span className="mt-0.5">✓</span>
                <span>Found: <span className="font-medium">{resolvedAddress}</span></span>
              </div>
            )}

            {geocodeStatus === 'not-found' && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <span className="font-medium">Couldn't find that address.</span>
                <br />
                Try a more specific address (street number + name + city), or use the photo scan instead — it uses your GPS to pin the exact location.
              </div>
            )}

            {geocodeStatus === 'error' && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                Something went wrong. Please try again.
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full mt-5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white py-3 px-4 rounded-lg font-semibold transition-colors"
          >
            {loading ? 'Adding...' : 'Add Venue'}
          </button>

          <p className="text-xs text-gray-400 text-center mt-3">
            Tip: Scan a menu photo instead — it's faster and pins the location automatically.
          </p>
        </form>
      </div>
    </>
  )
}

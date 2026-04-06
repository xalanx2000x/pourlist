'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'

interface MenuConfirmProps {
  file: File
  gps: { lat: number; lng: number } | null
  parsedText: string
  matchedVenue: Venue | null
  isDuplicate: boolean
  existingMenuText?: string | null
  onConfirm: (menuText: string, venueId?: string) => void
  onReject: () => void
  onClose: () => void
}

export default function MenuConfirm({
  file,
  gps,
  parsedText,
  matchedVenue,
  isDuplicate,
  existingMenuText,
  onConfirm,
  onReject,
  onClose
}: MenuConfirmProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(parsedText)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    try {
      onConfirm(text.trim(), matchedVenue?.id)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button onClick={onClose} className="text-white/80 hover:text-white text-sm">
          ← Cancel
        </button>
        <span className="font-semibold text-sm">Confirm Menu</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Venue match status */}
        {matchedVenue ? (
          <div className="mb-4">
            {isDuplicate ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-3">
                <p className="text-sm font-medium text-yellow-800">Similar menu already on file</p>
                <p className="text-xs text-yellow-600 mt-1">
                  This looks similar to the existing menu for {matchedVenue.name}.
                  Submitting will replace it if different.
                </p>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-3">
                <p className="text-sm font-medium text-green-800">✓ Adding to {matchedVenue.name}</p>
                <p className="text-xs text-green-600 mt-1">{matchedVenue.address}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
            <p className="text-sm font-medium text-blue-800">New venue</p>
            <p className="text-xs text-blue-600 mt-1">
              {gps
                ? `Location: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                : 'No location data — please verify the address'}
            </p>
          </div>
        )}

        {/* Parsed text */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-gray-700">Extracted Menu</label>
            <button
              onClick={() => setEditing(e => !e)}
              className="text-xs text-amber-600 hover:text-amber-700 font-medium"
            >
              {editing ? 'Done Editing' : 'Edit'}
            </button>
          </div>

          {editing ? (
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm leading-relaxed resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none min-h-[200px]"
              placeholder="Edit the menu text here..."
            />
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">
              {text || <span className="text-gray-400 italic">No menu text extracted</span>}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-2">
            Tap Edit to correct any parsing errors before submitting.
          </p>
        </div>

        {/* Existing menu comparison (if duplicate) */}
        {isDuplicate && existingMenuText && (
          <div className="mb-4">
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Current menu on file
            </label>
            <div className="bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-mono text-gray-500 max-h-40 overflow-y-auto">
              {existingMenuText}
            </div>
          </div>
        )}

        {/* Photo reference */}
        <div className="mb-4">
          <label className="text-sm font-semibold text-gray-700 mb-2 block">
            Source photo (reference only)
          </label>
          <img
            src={URL.createObjectURL(file)}
            alt="Menu photo"
            className="w-full max-h-48 object-contain rounded-xl bg-gray-100"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
        <button
          onClick={handleSubmit}
          disabled={submitting || !text.trim()}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white py-3.5 px-6 rounded-xl font-semibold text-base transition-colors"
        >
          {submitting ? 'Submitting...' : 'Save Menu'}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          Only the menu text is saved — photo is not stored permanently
        </p>
      </div>
    </div>
  )
}

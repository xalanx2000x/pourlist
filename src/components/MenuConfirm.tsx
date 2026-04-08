'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'

interface MenuConfirmProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  parsedText: string
  matchedVenue: Venue | null
  isDuplicate: boolean
  isNotHH: boolean
  existingMenuText?: string | null
  isLoading?: boolean
  saveError?: string
  onConfirm: (menuText: string, venueId?: string) => void
  onReject: () => void
  onClose: () => void
}

export default function MenuConfirm({
  files,
  gps,
  parsedText,
  matchedVenue,
  isDuplicate,
  isNotHH,
  existingMenuText,
  isLoading,
  saveError,
  onConfirm,
  onReject,
  onClose
}: MenuConfirmProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(parsedText)

  async function handleSubmit() {
    onConfirm(text.trim(), matchedVenue?.id)
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
        {isNotHH && !matchedVenue && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            <p className="text-sm font-medium text-amber-800">⚠️ This may not be a happy hour menu</p>
            <p className="text-xs text-amber-600 mt-1">
              No happy hour indicators found (time windows, discounts, HH language).
              Does this venue have a happy hour? You can still submit if it does.
            </p>
          </div>
        )}

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

          {editing || text === '[No menu text extracted]' || !text ? (
            <textarea
              value={text === '[No menu text extracted]' ? '' : text}
              onChange={e => setText(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm leading-relaxed resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none min-h-[200px]"
              placeholder="Type the happy hour menu items here..."
            />
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">
              {text}
            </div>
          )}

          {text === '[No menu text extracted]' && (
            <p className="text-xs text-amber-600 mt-2">
              Couldn't read the menu. Please type the happy hour items manually.
            </p>
          )}
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
            Source photo{files.length > 1 ? 's' : ''} (reference only)
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {files.map((file, i) => (
              <div key={i} className="shrink-0">
                <img
                  src={URL.createObjectURL(file)}
                  alt={`Menu page ${i + 1}`}
                  className="h-32 w-auto object-contain rounded-xl bg-gray-100"
                />
                {files.length > 1 && (
                  <p className="text-xs text-gray-400 text-center mt-1">Page {i + 1}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-3">
            <p className="text-sm font-medium text-red-700">Save failed</p>
            <p className="text-xs text-red-600 mt-0.5">{saveError}</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-400 text-white py-3.5 px-6 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Uploading & Saving...
            </>
          ) : (
            '💾 Save Menu'
          )}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          {files.length > 0
            ? 'The menu photo will be saved as a reference image'
            : 'Only the menu text will be saved'}
        </p>
      </div>
    </div>
  )
}

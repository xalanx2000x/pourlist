'use client'

import { useState, useEffect } from 'react'
import type { Venue } from '@/lib/supabase'
import { HHWindow, parseHHSchedule } from '@/lib/parse-hh'
import HHScheduleEditor from './HHScheduleEditor'

interface MenuReviewProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  venue: Venue | null
  newVenueName?: string | null
  /** Raw menu text (from AI parse) — used to pre-populate the HH schedule */
  menuText?: string | null
  onCommit: (data: {
    hhWindows: [HHWindow | null, HHWindow | null, HHWindow | null]
    hhTime: string   // legacy string for old API compatibility
  }) => Promise<void>
  onDiscard: () => void
  onRetry: () => void
  onClose: () => void
}

export default function MenuReview({
  files,
  gps,
  venue,
  newVenueName,
  menuText,
  onCommit,
  onDiscard,
  onRetry,
  onClose
}: MenuReviewProps) {
  const [hhWindows, setHhWindows] = useState<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const [legacyHhTime, setLegacyHhTime] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitError, setCommitError] = useState('')

  // Parse menu text on mount to pre-populate HH schedule
  useEffect(() => {
    if (menuText) {
      const schedule = parseHHSchedule(menuText)
      setHhWindows(schedule.windows)
    }
  }, [menuText])

  async function handleCommit() {
    setCommitError('')
    setIsCommitting(true)
    try {
      await onCommit({ hhWindows, hhTime: legacyHhTime })
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    } finally {
      setIsCommitting(false)
    }
  }

  const previewUrls = files.map(f => URL.createObjectURL(f))

  const venueLabel = venue
    ? venue.name
    : newVenueName
    ? `New: ${newVenueName}`
    : 'Unknown venue'

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white text-sm font-medium"
        >
          ← Back
        </button>
        <span className="font-semibold text-sm">Review</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Venue label */}
        <div className="flex items-center gap-2">
          <span className="text-sm">🏠</span>
          <span className="text-sm font-semibold text-gray-700">{venueLabel}</span>
          {venue?.address_backup && (
            <span className="text-xs text-gray-400 truncate">{venue.address_backup}</span>
          )}
        </div>

        {/* Photo strip (read-only) */}
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

        {/* HH Schedule editor */}
        <HHScheduleEditor
          initialWindows={hhWindows}
          onConfirm={setHhWindows}
          onAgreed={() => setAgreed(true)}
        />

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* Legacy HH time input (for old API / fallback) */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Happy Hour Time
          </label>
          <input
            type="text"
            value={legacyHhTime}
            onChange={(e) => setLegacyHhTime(e.target.value)}
            placeholder="e.g. Mon-Fri 4-7pm — or leave blank"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            {hhWindows[0] !== null
              ? 'Above schedule will be stored as structured data.'
              : 'Optional — leave blank if no happy hour.'}
          </p>
        </div>

        {/* Commit error */}
        {commitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <p className="text-sm font-medium text-red-700">Save failed</p>
            <p className="text-xs text-red-600 mt-0.5">{commitError}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
        <button
          onClick={handleCommit}
          disabled={isCommitting}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {isCommitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            '💾 Save'
          )}
        </button>
        <button
          onClick={onDiscard}
          className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-3 mt-1 transition-colors"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

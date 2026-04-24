'use client'

import { useState, useRef } from 'react'
import type { Venue } from '@/lib/supabase'
import { HHWindow } from '@/lib/parse-hh'
import HHScheduleInput from './HHScheduleInput'

interface MenuReviewProps {
  files: File[]
  /** Phone's current GPS — used for fraud/proximity warning check */
  phoneGps: { lat: number; lng: number } | null
  /** Authoritative venue location — EXIF GPS from first photo (new venue) or venue.lat/lng (existing) */
  venueGps: { lat: number; lng: number } | null
  venue: Venue | null
  newVenueName?: string | null
  menuText?: string | null
  onCommit: (data: {
    hhWindows: [HHWindow | null, HHWindow | null, HHWindow | null]
    hhTime: string
    hhSummary: string
  }) => Promise<void>
  onDiscard: () => void
  onRetry: () => void
  onClose: () => void
}

export default function MenuReview({
  files,
  phoneGps,
  venueGps,
  venue,
  newVenueName,
  menuText,
  onCommit,
  onDiscard,
  onRetry,
  onClose
}: MenuReviewProps) {
  // Ref to always hold the current windows — avoids stale closure in handleSave
  const hhWindowsRef = useRef<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const hhSummaryRef = useRef('')
  const [hhWindows, setHhWindows] = useState<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitError, setCommitError] = useState('')

  // Called by HHScheduleInput when user clicks "Confirm Happy Hour"
  function handleHhScheduleCommit(windows: [HHWindow | null, HHWindow | null, HHWindow | null], hhSummary: string) {
    hhWindowsRef.current = windows
    hhSummaryRef.current = hhSummary
    setHhWindows(windows)
    setCommitError('')
    setIsCommitting(true)
    onCommit({ hhWindows: windows, hhTime: '', hhSummary })
      .catch((err: unknown) => {
        setCommitError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
      })
      .finally(() => setIsCommitting(false))
  }

  // Called by the Save button in MenuReview
  async function handleSave() {
    setCommitError('')
    setIsCommitting(true)
    try {
      // Use ref to avoid stale closure — always reads the latest value
      await onCommit({ hhWindows: hhWindowsRef.current, hhTime: '', hhSummary: hhSummaryRef.current })
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

        {/* HH Schedule — two-box input */}
        <HHScheduleInput
          onChange={(windows) => {
            setHhWindows(windows)
            hhWindowsRef.current = windows
          }}
          onCommit={(windows, hhSummary) => {
            hhWindowsRef.current = windows
            hhSummaryRef.current = hhSummary
          }}
        />

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
          onClick={handleSave}
          disabled={isCommitting}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {isCommitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            '💾 Save Happy Hour'
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

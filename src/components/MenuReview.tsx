'use client'

import { useState, useRef } from 'react'
import type { Venue } from '@/lib/supabase'
import { HHWindow } from '@/lib/parse-hh'
import HHScheduleInput from './HHScheduleInput'
import { formatAddress } from '@/lib/format-address'

interface MenuReviewProps {
  files: File[]
  /** Phone's current GPS — used for fraud/proximity warning check */
  phoneGps: { lat: number; lng: number } | null
  /** Authoritative venue location — EXIF GPS from first photo (new venue) or venue.lat/lng (existing) */
  venueGps: { lat: number; lng: number } | null
  venue: Venue | null
  newVenueName?: string | null
  /** When present, this is a seed promotion (user is adding HH to a confirmed seed venue) */
  seedVenueName?: string | null
  menuText?: string | null
  onCommit: (data: {
    hhWindows: [HHWindow | null, HHWindow | null, HHWindow | null]
    hhTime: string
    hhSummary: string
    failedHhInput?: string | null   // set when commit SUCCEEDED but a prior attempt had been blocked
  }) => Promise<void>
  /** Callback (fire-and-forget) when HHScheduleInput blocks a submission attempt.
   *  Passed through to page.tsx for the parse_failure event. */
  onParseFailureAttempt?: (rawText: string) => void
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
  seedVenueName,
  menuText,
  onCommit,
  onDiscard,
  onRetry,
  onClose,
  onParseFailureAttempt
}: MenuReviewProps) {
  // Ref to always hold the current windows — avoids stale closure in handleSave
  const hhWindowsRef = useRef<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const hhSummaryRef = useRef('')
  // Holds the last distinct HH input that was blocked by the parser
  const failedHhInputRef = useRef<string | null>(null)
  const [hhWindows, setHhWindows] = useState<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitError, setCommitError] = useState('')

  // Derive whether HH is currently valid (at least one window parsed)
  const hhValid = hhWindows.some(w => w !== null)

  // Called when HHScheduleInput blocks a parse failure — store distinct failed input
  function handleParseFailureAttempt(rawText: string) {
    failedHhInputRef.current = rawText
    onParseFailureAttempt?.(rawText)
  }

  // Called by the Save button in MenuReview.
  // ONE submission path only — no immediate submit from HHScheduleInput's "Confirm".
  async function handleSave() {
    const hasHh = hhWindowsRef.current.some(w => w !== null) || hhSummaryRef.current.trim()
    if (!hasHh) {
      // Hard block — cannot submit without HH. No "save anyway".
      setCommitError('Add the happy hour times above before saving.')
      return
    }
    setCommitError('')
    setIsCommitting(true)
    try {
      const failedInput = failedHhInputRef.current
      failedHhInputRef.current = null
      await onCommit({
        hhWindows: hhWindowsRef.current,
        hhTime: '',
        hhSummary: hhSummaryRef.current,
        failedHhInput: failedInput,
      })
    } catch (err) {
      // err.message is the mapped, user-facing message from page.tsx
      setCommitError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setIsCommitting(false)
    }
  }

  const previewUrls = files.map(f => URL.createObjectURL(f))

  const venueLabel = venue
    ? venue.name
    : seedVenueName
    ? seedVenueName
    : newVenueName
    ? `New: ${newVenueName}`
    : 'Unknown venue'

  const labelPrefix = seedVenueName ? '🏠 ' : venue ? '' : newVenueName ? '✨ ' : ''

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
          {seedVenueName ? (
            <>
              <span className="text-sm">🏠</span>
              <span className="text-sm font-semibold text-gray-700">Adding HH for:</span>
              <span className="text-sm font-bold text-gray-900">{seedVenueName}</span>
            </>
          ) : (
            <>
              <span className="text-sm">🏠</span>
              <span className="text-sm font-semibold text-gray-700">{venueLabel}</span>
              {venue && formatAddress(venue) && (
                <span className="text-xs text-gray-400 truncate">{formatAddress(venue)}</span>
              )}
            </>
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
          onParseFailureAttempt={handleParseFailureAttempt}
          onChange={(windows, hhSummary) => {
            setHhWindows(windows)
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

        {/* Helper text shown under Save when HH is empty */}
        {!hhValid && !commitError && (
          <p className="text-xs text-gray-400 text-center">
            Enter the happy hour times above to save.
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
        <button
          onClick={handleSave}
          disabled={isCommitting || !hhValid}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
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

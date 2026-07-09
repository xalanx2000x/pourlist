'use client'

import { useState, useRef } from 'react'
import type { Venue } from '@/lib/supabase'
import { HHWindow } from '@/lib/parse-hh'
import HHScheduleInput from './HHScheduleInput'
import { formatAddress } from '@/lib/format-address'

type SaveStage = 'idle' | 'compressing' | 'uploading' | 'success' | 'error'

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
    failedHhInput?: string | null
  }) => Promise<void>
  /** Callback (fire-and-forget) when HHScheduleInput blocks a submission attempt. */
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
  onParseFailureAttempt,
  onDiscard,
  onRetry,
  onClose,
}: MenuReviewProps) {
  // Ref to always hold the current windows — avoids stale closure in handleSave
  const hhWindowsRef = useRef<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const hhSummaryRef = useRef('')
  // Holds the last distinct HH input that was blocked by the parser
  const failedHhInputRef = useRef<string | null>(null)

  const [hhWindows, setHhWindows] = useState<[HHWindow | null, HHWindow | null, HHWindow | null]>([null, null, null])
  const [saveStage, setSaveStage] = useState<SaveStage>('idle')
  const [commitError, setCommitError] = useState('')
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)

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
      setCommitError('Add the happy hour times above before saving.')
      return
    }
    setCommitError('')
    setDiscardConfirmOpen(false)

    // Stage B: compressing — photo compression runs synchronously before the fetch
    setSaveStage('compressing')

    try {
      const failedInput = failedHhInputRef.current
      failedHhInputRef.current = null

      // Stage C: uploading — fetch is in flight
      setSaveStage('uploading')

      await onCommit({
        hhWindows: hhWindowsRef.current,
        hhTime: '',
        hhSummary: hhSummaryRef.current,
        failedHhInput: failedInput,
      })

      // Success — page.tsx handles the toast + resetScan; just return to idle
      setSaveStage('success')
    } catch (err) {
      // Map server-said "nothing was saved" language to honest neutral wording
      const raw = err instanceof Error ? err.message : 'Something went wrong.'
      const isNetworkOrUnknown = !raw.includes('too_far') &&
        !raw.includes('no_gps') &&
        !raw.includes('duplicate') &&
        !raw.includes("already exists") &&
        !raw.includes("enable GPS") &&
        !raw.includes("not at the venue") &&
        !raw.includes("No location") &&
        !raw.includes("Failed to verify venue") &&
        !raw.includes("Failed to create venue") &&
        !raw.includes("Failed to save") &&
        !raw.includes("please try again") // rate-limit
      const honest = isNetworkOrUnknown
        ? 'Save didn\'t complete. Check your connection and tap Try again — your photos and happy hour entry are still here.'
        : raw
      setCommitError(honest)
      setSaveStage('error')
    }
    // Note: we intentionally do NOT reset to 'idle' on error — the error UI takes over.
    // On success, page.tsx unmounts us via resetScan, so no reset needed.
  }

  const previewUrls = files.map(f => URL.createObjectURL(f))

  const venueLabel = venue
    ? venue.name
    : seedVenueName
    ? seedVenueName
    : newVenueName
    ? `New: ${newVenueName}`
    : 'Unknown venue'

  // ── Derived button label + disabled state per save stage ──────────────────
  const isSaving = saveStage === 'compressing' || saveStage === 'uploading'
  const saveDisabled = isSaving || !hhValid

  function saveButtonContent() {
    if (saveStage === 'compressing') {
      return (
        <>
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Preparing photos…
        </>
      )
    }
    if (saveStage === 'uploading') {
      return (
        <>
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Saving…
        </>
      )
    }
    return '💾 Save Happy Hour'
  }

  // ── Discard confirmation modal ─────────────────────────────────────────────
  function handleDiscardClick() {
    if (saveStage === 'error') {
      // On error, discard skips the confirm dialog — user already chose to give up
      onDiscard()
      return
    }
    setDiscardConfirmOpen(true)
  }

  function handleDiscardConfirm() {
    setDiscardConfirmOpen(false)
    onDiscard()
  }

  function handleDiscardCancel() {
    setDiscardConfirmOpen(false)
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white text-sm font-medium"
          disabled={isSaving}
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

        {/* Stage A/E — error box with Try Again + Discard */}
        {commitError && saveStage === 'error' && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <p className="text-sm font-medium text-red-700">Save failed</p>
              <p className="text-xs text-red-600 mt-0.5">{commitError}</p>
            </div>
            {/* Try Again — primary */}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {saveStage === 'compressing' ? 'Preparing photos…' : 'Saving…'}
                </>
              ) : (
                '↻ Try again'
              )}
            </button>
            {/* Discard — secondary with confirmation */}
            <button
              onClick={handleDiscardClick}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
            >
              Discard
            </button>
          </div>
        )}

        {/* Helper text when HH is empty */}
        {!hhValid && saveStage === 'idle' && (
          <p className="text-xs text-gray-400 text-center">
            Enter the happy hour times above to save.
          </p>
        )}
      </div>

      {/* Action buttons — shown in stages A (idle) and C (uploading) */}
      {/* Hidden once saveStage reaches 'error' (error box above takes over) */}
      {saveStage !== 'error' && (
        <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
          <button
            onClick={handleSave}
            disabled={saveDisabled}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
          >
            {saveButtonContent()}
          </button>
          <button
            onClick={handleDiscardClick}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-3 mt-1 transition-colors"
          >
            Discard
          </button>
        </div>
      )}

      {/* Discard confirmation modal */}
      {discardConfirmOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-xl">
            <div>
              <p className="text-base font-semibold text-gray-900">Discard this entry?</p>
              <p className="text-sm text-gray-500 mt-1">
                This will delete your photos and happy hour entry. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDiscardCancel}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDiscardConfirm}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

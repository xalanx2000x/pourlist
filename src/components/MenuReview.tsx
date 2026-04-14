'use client'

import { useState, useEffect } from 'react'
import type { Venue } from '@/lib/supabase'

interface MenuReviewProps {
  files: File[]
  gps: { lat: number; lng: number } | null
  venue: Venue | null
  newVenueName?: string | null
  parsedText: string
  hhTimes: string[]
  isNotHH: boolean
  onCommit: (menuText: string, hhTime: string) => Promise<void>
  onDiscard: () => void
  onRetry: () => void
  onClose: () => void
}

export default function MenuReview({
  files,
  gps,
  venue,
  newVenueName,
  parsedText,
  hhTimes,
  isNotHH,
  onCommit,
  onDiscard,
  onRetry,
  onClose
}: MenuReviewProps) {
  const [text, setText] = useState(parsedText)
  const [hhTime, setHhTime] = useState(hhTimes.join(', '))
  const [editing, setEditing] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [commitError, setCommitError] = useState('')

  // Keep in sync when props change (e.g., when parent finishes parsing)
  useEffect(() => {
    setText(parsedText)
    setHhTime(hhTimes.join(', '))
  }, [parsedText, hhTimes])

  // If no HH detected, show error state
  if (isNotHH) {
    return (
      <div className="fixed inset-0 bg-white z-50 flex flex-col">
        {/* Header */}
        <div className="shrink-0 bg-amber-500 text-white px-4 py-3 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-sm font-medium"
          >
            ✕
          </button>
          <span className="font-semibold text-sm">Menu Review</span>
          <div className="w-10" />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="text-5xl mb-4">📷</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            No Happy Hour Found
          </h2>
          <p className="text-gray-500 max-w-xs mx-auto leading-relaxed">
            No happy hour times were detected in this menu. Make sure you&apos;re
            uploading a happy hour menu and try again with better lighting.
          </p>
        </div>

        <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
          <button
            onClick={onRetry}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3.5 rounded-xl font-semibold text-base transition-colors"
          >
            📷 Try Again
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

  async function handleCommit() {
    setCommitError('')
    setIsCommitting(true)
    try {
      await onCommit(text.trim(), hhTime.trim())
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
          ✕
        </button>
        <span className="font-semibold text-sm">Review Menu</span>
        <div className="w-10" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Venue label */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">🏠</span>
          <span className="text-sm font-semibold text-gray-700">{venueLabel}</span>
          {venue?.address && (
            <span className="text-xs text-gray-400 truncate">{venue.address}</span>
          )}
        </div>

        {/* Photo strip (read-only) */}
        {previewUrls.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {previewUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Menu page ${i + 1}`}
                className="h-16 w-auto object-contain rounded-xl bg-gray-100 shrink-0"
              />
            ))}
          </div>
        )}

        {/* HH Time field */}
        <div className="mb-3">
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Happy Hour Time
          </label>
          <input
            type="text"
            value={hhTime}
            onChange={(e) => setHhTime(e.target.value)}
            placeholder="e.g. 4-6pm, daily"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
          />
        </div>

        {/* Parsed menu text */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-semibold text-gray-700">
              Parsed Menu Text
            </label>
            <button
              onClick={() => setEditing((e) => !e)}
              className="text-xs text-amber-600 hover:text-amber-700 font-medium"
            >
              {editing ? 'Done Editing' : 'Edit'}
            </button>
          </div>

          {editing ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm leading-relaxed resize-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none min-h-[200px]"
              placeholder="Menu items..."
            />
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">
              {text || (
                <span className="text-gray-400 italic">No menu text available</span>
              )}
            </div>
          )}
        </div>

        {/* Commit error */}
        {commitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-3">
            <p className="text-sm font-medium text-red-700">Save failed</p>
            <p className="text-xs text-red-600 mt-0.5">{commitError}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
        <button
          onClick={handleCommit}
          disabled={isCommitting || !text.trim()}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white py-3.5 rounded-xl font-semibold text-base transition-colors flex items-center justify-center gap-2"
        >
          {isCommitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            '💾 Commit Menu'
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

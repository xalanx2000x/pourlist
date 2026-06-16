'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'
import { shareVenue, type ShareResult } from '@/lib/share'

interface ShareButtonProps {
  venue: Venue
  className?: string
}

/**
 * Icon-only share button. 44×44px tap target so it's not fat-fingered
 * against the card tap area or the photo indicator. Local toast state
 * for the clipboard fallback ("Link copied!").
 *
 * For nested use inside a clickable parent (VenueCard), this button
 * stops propagation on both click and keydown so the parent's
 * handler doesn't fire.
 */
export default function ShareButton({ venue, className = '' }: ShareButtonProps) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2000)
  }

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const result: ShareResult = await shareVenue(venue)
    if (result === 'copied') showToast('Link copied!')
    else if (result === 'error') showToast("Couldn't share — try again")
    // 'shared' and 'cancelled' = no toast (system sheet already handled it)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Stop Enter/Space from bubbling to a clickable parent (e.g. VenueCard)
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={`Share ${venue.name}`}
        className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 rounded-full text-gray-400 hover:text-amber-600 active:text-amber-700 hover:bg-gray-100 active:bg-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${className}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg pointer-events-none"
        >
          {toast}
        </div>
      )}
    </>
  )
}

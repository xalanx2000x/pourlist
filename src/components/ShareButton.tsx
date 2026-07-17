'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'
import type { LeanVenue } from '@/lib/venues'
import { shareVenue, type ShareResult } from '@/lib/share'

interface ShareButtonVenueProps {
  venue: Venue | LeanVenue
  title?: never
  text?: never
  url?: never
  /** Visual override: 'icon' (default) renders just the icon. 'labeled'
   *  renders "Share" next to the icon (used on city/neighborhood/venue
   *  page card headers where there's room). */
  variant?: 'icon' | 'labeled'
  className?: string
}

interface ShareButtonLabeledProps {
  venue?: never
  /** Title for the share sheet (also used in aria-label). */
  title: string
  /** Text body. If omitted, falls back to `title`. */
  text?: string
  /** URL to share. Defaults to current page URL at click time. */
  url?: string
  variant?: 'icon' | 'labeled'
  className?: string
}

type ShareButtonProps = ShareButtonVenueProps | ShareButtonLabeledProps

function isLabeledMode(props: ShareButtonProps): props is ShareButtonLabeledProps {
  return typeof (props as ShareButtonLabeledProps).title === 'string'
}

function ShareIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* iOS-style share glyph: square with arrow pointing up out of it */}
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}

/**
 * Share button.
 *
 * Two modes:
 *   - Pass `venue` → uses shareVenue(venue) from lib/share to derive URL +
 *     text body. Existing behavior, used in VenueCard / VenueDetail.
 *   - Pass `title` (+ optional `text`, `url`) → for SEO pages
 *     (city / neighborhood / venue) that don't have a venue object but
 *     know the shareable title and page URL.
 *
 * On tap: prefers navigator.share() (native mobile share sheet) and falls
 * back to navigator.clipboard.writeText() on desktop, surfacing a small
 * toast that reads "Link copied!".
 *
 * Visual variants:
 *   - 'icon' (default, for in-app cards): 44×44 tap target, no text label
 *   - 'labeled' (for SEO card headers): icon + "Share" text inline
 *
 * For nested use inside a clickable parent (e.g. VenueCard), this
 * button stops propagation on click + keydown so the parent's handler
 * doesn't fire.
 */
export default function ShareButton(props: ShareButtonProps) {
  const [toast, setToast] = useState<string | null>(null)
  const variant = props.variant ?? 'icon'
  const isLabeled = variant === 'labeled'

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2000)
  }

  function currentUrl(): string {
    if (typeof window === 'undefined') return ''
    return window.location.href
  }

  async function handleLabeledShare() {
    if (!isLabeledMode(props)) return
    const url = props.url ?? currentUrl()
    const text = props.text ?? props.title
    const fallbackText = url ? `${props.title}\n${url}` : props.title

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: props.title, text, url })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        // fall through to clipboard
      }
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(fallbackText)
        showToast('Link copied!')
        return
      } catch {
        showToast("Couldn't copy link")
        return
      }
    }
    showToast("Can't share on this device")
  }

  async function handleVenueShare(e: React.MouseEvent) {
    if (isLabeledMode(props)) return
    e.stopPropagation()
    const result: ShareResult = await shareVenue(props.venue)
    if (result === 'copied') showToast('Link copied!')
    else if (result === 'error') showToast("Couldn't share — try again")
    // 'shared' and 'cancelled' = no toast
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isLabeledMode(props)) return
    // Stop Enter/Space from bubbling to a clickable parent (e.g. VenueCard)
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (isLabeledMode(props)) {
      e.preventDefault()
      void handleLabeledShare()
      return
    }
    void handleVenueShare(e)
  }

  const ariaLabel = isLabeledMode(props)
    ? `Share: ${props.title}`
    : `Share ${props.venue.name}`

  const baseClass = isLabeled
    ? `inline-flex items-center gap-1.5 text-gray-500 hover:text-amber-700 active:text-amber-800 transition-colors text-sm font-semibold ${props.className ?? ''}`
    : `inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-2.5 rounded-full text-gray-400 hover:text-amber-600 active:text-amber-700 hover:bg-gray-100 active:bg-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${props.className ?? ''}`

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        className={baseClass}
      >
        <ShareIcon className={isLabeled ? 'w-4 h-4' : 'w-[18px] h-[18px]'} />
        {isLabeled && <span>Share</span>}
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

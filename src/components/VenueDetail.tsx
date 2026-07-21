'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Venue } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { hasActiveHappyHour } from '@/lib/hh-state'
import { getDeviceHash } from '@/lib/device'
import { getHhLabel, formatWindow } from '@/lib/format-schedule'
import ShareButton from './ShareButton'
import { formatAddress, normalizeAddress } from '@/lib/format-address'
import { isWithinPresence } from '@/lib/gpsCheck'

type ActionState = 'idle' | 'loading' | 'success' | 'error'

interface VenueDetailProps {
  venue: Venue
  onClose: () => void
  /** Called when user taps "Scan Menu" — page.tsx starts the scan flow with this venue pre-selected */
  onScanMenu: (venue: Venue) => void
}

interface PhotoSet {
  id: string
  created_at: string
  photo_urls: string[]
}

export default function VenueDetail({ venue, onClose, onScanMenu }: VenueDetailProps) {
  const isActiveHH = hasActiveHappyHour(venue)

  const [flagState, setFlagState] = useState<ActionState>('idle')
  const [flagError, setFlagError] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  // True while the geolocation request is in flight. Cleared when resolved OR denied.
  // Drives the 'Checking location…' neutral button state.
  const [locating, setLocating] = useState(true)
  // True when the user has attempted and been blocked — holds the block across
  // GPS-driven re-renders so a background GPS fix doesn't silently unblock them.
  const [blocked, setBlocked] = useState(false)
  // The block message shown when the user attempts and is refused.
  const [blockMsg, setBlockMsg] = useState('')

  // Derived gate values — always current with the latest userLocation.
  const noGpsOrDenied = !userLocation  // null GPS (still loading or permanently denied)
  const outOfRange = !!(
    userLocation &&
    venue.lat != null && venue.lng != null &&
    !isWithinPresence(userLocation.lat, userLocation.lng, venue.lat, venue.lng, userLocation.accuracy)
  )
  // isBlocked: user attempted + was blocked (held), OR GPS permanently denied.
  // Note: 'still loading' (locating=true) does NOT count as blocked here — that
  // is the 'locating' scan state handled separately in the button below.
  const isBlocked = blocked || !!locationError  // blocked by user action, or GPS permanently denied

  // The scan button has four mutually-exclusive states:
  //   locating:  GPS request in flight → neutral 'Checking location…'
  //   in_range:  GPS resolved + in range → active 'Scan Menu'
  //   out_range: GPS resolved + out of range → grey 'Too far to scan'
  //   no_gps:    GPS permanently denied → red 'Too far to scan'
  type ScanButtonState = 'locating' | 'in_range' | 'out_of_range' | 'no_gps'
  const scanBtnState: ScanButtonState =
    locating ? 'locating' :
    !userLocation ? 'no_gps' :     // GPS denied, not just still loading
    outOfRange  ? 'out_of_range' :
    'in_range'

  const blockMessage = blockMsg || (userLocation
    ? `You appear to be too far from ${venue.name} to add its happy hour. Please get closer to the venue.`
    : 'PourList needs your location to confirm you\'re at the venue. Please enable location and try again.')

  // Photo viewer state
  const [photoSets, setPhotoSets] = useState<PhotoSet[]>([])
  const [photoSetsLoading, setPhotoSetsLoading] = useState(false)
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false)
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState(0)
  const [allPhotos, setAllPhotos] = useState<{ url: string; setIndex: number; photoIndex: number }[]>([])

  // Swipe-down to close — touch handler fires anywhere on the card
  // (touchscreens only). Pointer handler on the drag handle covers
  // trackpad/mouse drag-to-dismiss without false positives from
  // text-selection drags on the card content.
  const touchStartY = useRef<number | null>(null)
  const pointerStartY = useRef<number | null>(null)
  const hasMovedDownRef = useRef(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    hasMovedDownRef.current = false
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return
    // The scrollable element IS the currentTarget (has overflow-y-auto), not a child
    const scrollEl = e.currentTarget as HTMLElement
    const scrollTop = scrollEl.scrollTop
    const currentY = e.touches[0].clientY
    const deltaY = currentY - touchStartY.current

    if (scrollTop === 0 && deltaY > 10) {
      hasMovedDownRef.current = true
    }
  }

  const handleTouchEnd = () => {
    if (hasMovedDownRef.current) {
      onClose()
    }
    touchStartY.current = null
    hasMovedDownRef.current = false
  }

  // Trackpad/mouse drag-to-dismiss on the drag handle. Pointer events
  // are unified across input types; on a trackpad/mouse this fires
  // when the user clicks the handle and drags down.
  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStartY.current = e.clientY
    hasMovedDownRef.current = false
  }

  const handlePointerMove = (_e: React.PointerEvent) => {
    if (pointerStartY.current === null) return
    const deltaY = _e.clientY - pointerStartY.current
    if (deltaY > 10) {
      hasMovedDownRef.current = true
    }
  }

  const handlePointerUp = () => {
    if (hasMovedDownRef.current) {
      onClose()
    }
    pointerStartY.current = null
    hasMovedDownRef.current = false
  }

  // Fetch all photo sets for this venue
  useEffect(() => {
    async function fetchPhotoSets() {
      setPhotoSetsLoading(true)
      const { data, error } = await supabase
        .from('photo_sets')
        .select('id, created_at, photo_urls')
        .eq('venue_id', venue.id)
        .order('created_at', { ascending: false })
        .limit(4)
      if (!error && data) {
        setPhotoSets(data as PhotoSet[])
      }
      setPhotoSetsLoading(false)
    }
    fetchPhotoSets()
  }, [venue.id])

  // Build flattened list of all photos when sets change
  useEffect(() => {
    const photos: { url: string; setIndex: number; photoIndex: number }[] = []
    photoSets.forEach((set, setIdx) => {
      set.photo_urls.forEach((url, photoIdx) => {
        photos.push({ url, setIndex: setIdx, photoIndex: photoIdx })
      })
    })
    setAllPhotos(photos)
  }, [photoSets])

  // Request geolocation on mount (for proximity gate + flag button)
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLocationError('Location not available')
      setLocating(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        setLocating(false)
      },
      () => {
        setLocationError('Location unavailable')
        setLocating(false)
      }
    )
  }, [])

  const handleFlag = useCallback(async () => {
    if (!userLocation) {
      setFlagError('Need your location to flag — enable GPS')
      return
    }
    setFlagState('loading')
    setFlagError(null)

    try {
      const res = await fetch('/api/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          deviceHash: getDeviceHash(),
          reason: 'no_hh',
          lat: userLocation.lat,
          lng: userLocation.lng,
          ...(userLocation.accuracy != null && { accuracy: userLocation.accuracy })
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setFlagError(data.error || 'Failed to flag')
        setFlagState('error')
        return
      }
      setFlagState('success')
      setSuccessMessage('Reported — thanks for keeping it accurate')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setFlagError('Network error — try again')
      setFlagState('error')
    }
  }, [venue.id, userLocation])

  function openPhotoViewer(photoIndex: number) {
    setViewerPhotoIndex(photoIndex)
    setPhotoViewerOpen(true)
  }

  function closePhotoViewer() {
    setPhotoViewerOpen(false)
  }

  // Escape closes the photo lightbox (standard lightbox behavior on desktop).
  useEffect(() => {
    if (!photoViewerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePhotoViewer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photoViewerOpen])

  function prevPhoto() {
    setViewerPhotoIndex(prev => (prev > 0 ? prev - 1 : allPhotos.length - 1))
  }

  function nextPhoto() {
    setViewerPhotoIndex(prev => (prev < allPhotos.length - 1 ? prev + 1 : 0))
  }

  // Only show moderation buttons for verified/stale venues
  // Show "Does this place not have Happy Hour?" for any venue that could still be on the map.
  // Flagging 'no_hh' closes a venue immediately (1 flag), so all statuses are eligible.
  const showModeration = venue.status !== 'closed'

  function formatSetDate(dateStr: string) {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div
      className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto z-50"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Handle bar — swipe indicator (touch) + drag-to-dismiss (trackpad/mouse) */}
      <div
        className="flex justify-center pt-4 pb-3 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="w-12 h-1 bg-gray-300 rounded-full" />
      </div>

      <div className="p-5">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-start gap-2 flex-wrap">
            <h2
              className={`text-xl font-bold ${isActiveHH ? 'text-purple-600' : 'text-gray-900'}`}
              style={isActiveHH ? { textShadow: '0 0 18px rgba(147,51,234,0.6), 0 0 36px rgba(147,51,234,0.25)' } : undefined}
            >
              {venue.name}
            </h2>
            {isActiveHH && (
              <span className="text-xs bg-purple-600 text-white px-2.5 py-0.5 rounded-full font-semibold mt-1">
                HH Active
              </span>
            )}
            {venue.status === 'unverified' && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full mt-1">
                New
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <ShareButton venue={venue} />
              <button
                onClick={onClose}
                className="hidden md:flex w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 items-center justify-center text-gray-500 hover:text-gray-700 text-xl font-medium transition-colors"
                aria-label="Close venue details"
              >
                ×
              </button>
            </div>
          </div>
          <p className="text-gray-600 mt-1">{formatAddress(venue)}</p>
          {venue.phone && (
            <a href={`tel:${venue.phone}`} className="text-sm text-amber-600 hover:underline mt-1 block">
              {venue.phone}
            </a>
          )}
          {venue.website ? (
            <a href={venue.website.startsWith('http') ? venue.website : `https://${venue.website}`} target="_blank" rel="noopener noreferrer" className="text-sm text-amber-600 hover:underline mt-1 block">
              Visit website →
            </a>
          ) : (
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(venue.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-amber-600 hover:underline mt-1 block"
            >
              Search on Google →
            </a>
          )}
        </div>

        {/* Type badge */}
        {venue.type && (
          <span className="inline-block text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full mb-4">
            {venue.type}
          </span>
        )}

        {/* Success message */}
        {successMessage && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2.5 rounded-xl">
            ✅ {successMessage}
          </div>
        )}

        {/* Happy Hour Schedule — dedicated section */}
        {(getHhLabel(venue) ?? venue.hh_time) && (
          <div className="mb-5 bg-purple-50 border border-purple-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🍺</span>
                <h3 className="text-sm font-semibold text-purple-800">Happy Hour</h3>
              </div>
              {isActiveHH && (
                <span className="text-xs bg-purple-600 text-white px-2.5 py-0.5 rounded-full font-bold">
                  ● Active now
                </span>
              )}
            </div>

            {/* Window rows */}
            <div className="space-y-2">
              {[
                {
                  type: venue.hh_type,
                  daysStr: venue.hh_days ?? null,
                  excludeStr: venue.hh_exclude_days ?? null,
                  startMin: venue.hh_start,
                  endMin: venue.hh_end,
                },
                {
                  type: venue.hh_type_2,
                  daysStr: venue.hh_days_2 ?? null,
                  excludeStr: venue.hh_exclude_days_2 ?? null,
                  startMin: venue.hh_start_2,
                  endMin: venue.hh_end_2,
                },
                {
                  type: venue.hh_type_3,
                  daysStr: venue.hh_days_3 ?? null,
                  excludeStr: venue.hh_exclude_days_3 ?? null,
                  startMin: venue.hh_start_3,
                  endMin: venue.hh_end_3,
                },
              ].map((w, i) => {
                const label = formatWindow(w.type, w.daysStr, w.startMin, w.endMin, w.excludeStr)
                if (!label) return null
                return (
                  <div key={i} className="flex items-start gap-2.5">
                    {/* Window type icon */}
                    <span className="mt-0.5 text-sm">
                      {w.type === 'all_day' ? '💍' :
                       w.type === 'late_night' ? '🌙' : '⏰'}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-900">{label}</p>
                      <p className="text-xs text-amber-600 capitalize">
                        {w.type === 'all_day' ? 'All day' :
                         w.type === 'late_night' ? 'Late night' : 'Happy hour'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legacy HH time (for pre-migration venues) */}
            {!venue.hh_type && venue.hh_time && (
              <p className="text-sm font-medium text-amber-900">{venue.hh_time}</p>
            )}
          </div>
        )}

        {/* Moderation buttons */}
        {/* Flag as closed — discreet text link */}
        {showModeration && (
          <div className="mb-4">
            {flagState === 'success' ? (
              <p className="text-xs text-green-600">Reported — thanks</p>
            ) : (
              <button
                onClick={handleFlag}
                disabled={flagState === 'loading' || !userLocation}
                className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50 disabled:cursor-not-allowed underline"
                title={!userLocation ? 'Enable location to report' : undefined}
              >
                {flagState === 'loading' ? 'Reporting…' : 'Does this place not have Happy Hour?'}
              </button>
            )}
            {!userLocation && !locationError && !flagError && (
              <span className="text-xs text-gray-400 ml-2">📍</span>
            )}
            {locationError && (
              <span className="text-xs text-gray-400 ml-2">({locationError})</span>
            )}
            {flagError && (
              <span className="text-xs text-red-500 ml-2">{flagError}</span>
            )}
          </div>
        )}

        {/* Menu photo sets */}
        {photoSetsLoading ? (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
            <span>Loading photos…</span>
          </div>
        ) : photoSets.length > 0 ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Menu Photos</h3>
              <span className="text-xs text-gray-400">{photoSets.length} set{photoSets.length !== 1 ? 's' : ''}</span>
            </div>

            {photoSets.map((set, setIdx) => (
              <div key={set.id} className="mb-4 last:mb-0">
                {/* Date header for this set */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-gray-500 font-medium">
                    {formatSetDate(set.created_at)}
                  </span>
                  {setIdx === 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
                      Latest
                    </span>
                  )}
                  <div className="flex-1 h-px bg-gray-100" />
                </div>

                {/* Photos in this set — horizontal scroll */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {set.photo_urls.map((url, photoIdx) => {
                    // Global photo index across all sets
                    let globalIdx = 0
                    for (let si = 0; si < setIdx; si++) {
                      globalIdx += photoSets[si].photo_urls.length
                    }
                    globalIdx += photoIdx

                    return (
                      <button
                        key={url}
                        onClick={() => openPhotoViewer(globalIdx)}
                        className="shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-gray-200 hover:border-amber-400 transition-colors"
                      >
                        <img
                          src={url}
                          alt={`Menu photo ${photoIdx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-5">
            <p className="text-sm text-gray-400 italic text-center py-3 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              No menu on file yet. Be the first to scan it!
            </p>
          </div>
        )}

        {/* Menu text — only shown when there is text */}
        {venue.menu_text && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Happy Hour Menu</h3>
              <span className="text-xs text-gray-400">
                {venue.menu_text_updated_at
                  ? `Updated ${new Date(venue.menu_text_updated_at).toLocaleDateString()}`
                  : ''}
              </span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
              {venue.menu_text}
            </div>
          </div>
        )}

        {/* No menu on file — only shown when there is no photo AND no text */}
        {!venue.menu_text && photoSets.length === 0 && !photoSetsLoading && (
          <div className="mb-5">
            <p className="text-sm text-gray-400 italic text-center py-3 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              No menu on file yet. Be the first to scan it!
            </p>
          </div>
        )}

        {/* Scan Menu button — always visible when viewing a venue */}
        <button
          onClick={() => {
            // Gate: only fire if in range. The scanBtnState derivation handles
            // the four states; here we guard the fire action.
            if (scanBtnState === 'in_range') {
              setBlocked(false)
              setBlockMsg('')
              onScanMenu(venue)
            } else if (scanBtnState === 'out_of_range') {
              // User attempted but is out of range — hold the block.
              setBlocked(true)
              setBlockMsg(blockMessage)
            } else if (scanBtnState === 'no_gps') {
              setBlocked(true)
              setBlockMsg('PourList needs your location to confirm you\'re at the venue. Please enable location and try again.')
            }
            // 'locating' state: button is not clickable, no action.
          }}
          disabled={scanBtnState !== 'in_range'}
          className={`w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-colors mb-2 ${
            scanBtnState === 'locating'    ? 'bg-gray-200 text-gray-400 cursor-not-allowed' :
            (scanBtnState === 'out_of_range' || scanBtnState === 'no_gps')
                                       ? 'bg-gray-300 text-gray-500 cursor-not-allowed' :
            'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white'
          }`}
        >
          <span className="text-xl">{scanBtnState === 'in_range' ? '📷' : '📍'}</span>
          {scanBtnState === 'locating'    ? 'Checking location…' :
           scanBtnState === 'out_of_range' ? 'Too far to scan' :
           scanBtnState === 'no_gps'     ? 'Enable location to scan' :
           'Scan Menu'}
        </button>
        {scanBtnState === 'out_of_range' && (
          <p className="text-xs text-gray-500 px-1 mb-3">
            You appear to be too far from {venue.name} to add its happy hour. Please get closer to the venue.
          </p>
        )}
        {scanBtnState === 'no_gps' && (
          <p className="text-xs text-gray-500 px-1 mb-3">
            Location access is needed to scan a venue&apos;s menu — please enable it in your browser settings.
          </p>
        )}

        {/* Google/Yelp links */}
        <div className="flex gap-3 mb-5">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.name, normalizeAddress(venue.address)].filter(s => s).join(' '))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            📍 Directions
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.name, normalizeAddress(venue.address)].filter(s => s).join(' '))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-amber-100 hover:bg-amber-200 text-amber-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            ⭐ on Google
          </a>
        </div>

        {/* Scan call-to-action */}
        <p className="text-xs text-gray-400 text-center">
          Tap "Scan Happy Hour Menu" at the bottom to add or update menu info
        </p>
      </div>

      {/* Full-screen photo viewer — all photos, navigable */}
      {photoViewerOpen && allPhotos.length > 0 && (
        <div
          className="fixed inset-0 z-[200] bg-black/95"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePhotoViewer()
          }}
        >
          {/* Header — absolute overlaid on top of image. pointer-events-none so clicks pass through to the close button below. */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/60 z-10 pointer-events-none">
            <button
              onClick={closePhotoViewer}
              className="flex items-center gap-2 text-white text-sm font-medium px-2 py-1 rounded hover:bg-white/10 transition-colors pointer-events-auto"
            >
              ← Back
            </button>
            <span className="text-white/80 text-xs font-medium">
              {viewerPhotoIndex + 1} / {allPhotos.length}
            </span>
            <div className="w-16" /> {/* spacer to keep counter centered */}
          </div>

          {/* Close button — independently positioned in the top-right corner.
              Lives OUTSIDE the header so it can't be hidden by any header issue.
              Visible background pill + "Close" text + X icon = unmissable. */}
          <button
            onClick={closePhotoViewer}
            aria-label="Close photo viewer"
            className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-2 bg-white/90 hover:bg-white text-black rounded-full text-sm font-semibold shadow-lg transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="5" x2="17" y2="17" />
              <line x1="17" y1="5" x2="5" y2="17" />
            </svg>
            <span>Close</span>
          </button>

          {/* Full-screen image area */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Prev button */}
            <button
              onClick={prevPhoto}
              className="absolute left-2 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white/80 hover:text-white transition-colors z-10"
              aria-label="Previous photo"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M12 4l-8 8 8 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <img
              src={allPhotos[viewerPhotoIndex].url}
              alt={`Photo ${viewerPhotoIndex + 1}`}
              className="max-w-full max-h-full object-contain"
            />

            {/* Next button */}
            <button
              onClick={nextPhoto}
              className="absolute right-2 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white/80 hover:text-white transition-colors z-10"
              aria-label="Next photo"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Dots indicator — absolute at bottom */}
          <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-1.5 z-10">
            {allPhotos.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setViewerPhotoIndex(idx)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  idx === viewerPhotoIndex ? 'bg-white' : 'bg-white/30'
                }`}
                aria-label={`Go to photo ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Venue } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { hasActiveHappyHour, formatMin } from '@/lib/activeHH'
import { getDeviceHash } from '@/lib/device'

type ActionState = 'idle' | 'loading' | 'success' | 'error'

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Format a day range or list into a human-readable string.
 * [1, 2, 3, 4, 5] → "Mon–Fri"
 * [1, 3, 5] → "Mon, Wed, Fri"
 * [6, 7] → "Sat–Sun"
 * [1, 2, 3, 4, 5, 6, 7] → "Daily"
 * [1, 2, 3, 4, 5, 6, 7] + exclude=[6, 7] → "Weekdays"
 * [1, 2, 3, 4, 5, 6, 7] + exclude=[3] → "Daily except Tue"
 */
function formatDays(days: number[], excludeDays: number[] = []): string {
  if (days.length === 0 && excludeDays.length === 0) return ''
  if (days.length === 0) return ''

  const sorted = [...days].sort((a, b) => a - b)
  const exclSet = new Set(excludeDays)

  if (sorted.length === 7 && excludeDays.length === 0) return 'Daily'
  if (sorted.length === 7 && excludeDays.length > 0) {
    if (excludeDays.sort((a, b) => a - b).join(',') === '6,7') return 'Weekdays'
    const exclNames = excludeDays.sort((a, b) => a - b).map(d => DAY_SHORT[d - 1])
    return `Daily except ${exclNames.join(', ')}`
  }
  if (sorted.length === 2 && sorted[1] - sorted[0] === 1 &&
      [1, 2, 3, 4, 5, 6].includes(sorted[0]) &&
      sorted[0] + 1 === sorted[1]) {
    return `${DAY_SHORT[sorted[0] - 1]}–${DAY_SHORT[sorted[1] - 1]}`
  }

  return sorted.map(d => DAY_SHORT[d - 1]).join(', ')
}

/**
 * Format one structured HH window into a human-readable string.
 */
function formatWindow(
  type: string | null | undefined,
  daysStr: string | null | undefined,
  startMin: number | null | undefined,
  endMin: number | null | undefined,
  excludeDaysStr: string | null | undefined
): string | null {
  if (!type) return null

  const days = daysStr
    ? daysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
    : []
  const excludeDays = excludeDaysStr
    ? excludeDaysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
    : []
  const dayLabel = formatDays(days, excludeDays)

  if (type === 'all_day') return dayLabel ? `${dayLabel} all day` : 'All day'
  if (type === 'open_through') {
    // null end means "to close" — "midnight" is clearer than "close" for the HH context
    const end = endMin != null ? formatMin(endMin) : 'midnight'
    return dayLabel ? `${dayLabel} until ${end}` : `Until ${end}`
  }
  if (type === 'late_night') {
    // endMin=null means "to close"; startMin=null means no start specified
    if (startMin == null) {
      return dayLabel ? `${dayLabel} late night` : 'Late night'
    }
    const start = formatMin(startMin)
    const end = endMin != null ? formatMin(endMin) : 'midnight'
    return dayLabel ? `${dayLabel} ${start}–${end}` : `${start}–${end}`
  }
  if (type === 'typical') {
    if (startMin == null || endMin == null) return null
    const start = formatMin(startMin)
    const end = formatMin(endMin)
    if (!dayLabel) return `${start}–${end}`
    // Handle midnight crossing
    if (endMin < startMin) return `${dayLabel} ${start}–${end}+`
    return `${dayLabel} ${start}–${end}`
  }
  return null
}

/**
 * Get a human-readable label for the venue's structured HH schedule.
 * Returns null if no structured HH data exists.
 */
function getHhLabel(venue: Venue): string | null {
  const parts: string[] = []
  const w1 = formatWindow(venue.hh_type, venue.hh_days, venue.hh_start, venue.hh_end, venue.hh_exclude_days)
  const w2 = formatWindow(venue.hh_type_2, venue.hh_days_2, venue.hh_start_2, venue.hh_end_2, venue.hh_exclude_days_2)
  const w3 = formatWindow(venue.hh_type_3, venue.hh_days_3, venue.hh_start_3, venue.hh_end_3, venue.hh_exclude_days_3)
  if (w1) parts.push(w1)
  if (w2) parts.push(w2)
  if (w3) parts.push(w3)

  // If we got no structured text, fall back to hh_summary (the raw user input text)
  if (parts.length === 0 && venue.hh_summary) {
    return venue.hh_summary
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

interface VenueDetailProps {
  venue: Venue
  onClose: () => void
}

interface PhotoSet {
  id: string
  created_at: string
  photo_urls: string[]
}

export default function VenueDetail({ venue, onClose }: VenueDetailProps) {
  const isActiveHH = hasActiveHappyHour(venue)

  const [flagState, setFlagState] = useState<ActionState>('idle')
  const [flagError, setFlagError] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Photo viewer state
  const [photoSets, setPhotoSets] = useState<PhotoSet[]>([])
  const [photoSetsLoading, setPhotoSetsLoading] = useState(false)
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false)
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState(0)
  const [allPhotos, setAllPhotos] = useState<{ url: string; setIndex: number; photoIndex: number }[]>([])

  // Swipe-down to close — only when at top of scroll (not mid-scroll)
  const touchStartY = useRef<number | null>(null)
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

  // Request geolocation on mount (for flag button)
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setLocationError('Location not available')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationError('Location unavailable')
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
          lng: userLocation.lng
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

  function prevPhoto() {
    setViewerPhotoIndex(prev => (prev > 0 ? prev - 1 : allPhotos.length - 1))
  }

  function nextPhoto() {
    setViewerPhotoIndex(prev => (prev < allPhotos.length - 1 ? prev + 1 : 0))
  }

  // Only show moderation buttons for verified/stale venues
  const showModeration = venue.status === 'verified' || venue.status === 'stale'

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
      {/* Handle bar — swipe indicator */}
      <div className="flex justify-center pt-3 pb-1">
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
            {venue.status === 'stale' && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full mt-1">
                Needs Update
              </span>
            )}
          </div>
          <p className="text-gray-600 mt-1">{venue.address_backup}</p>
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
                       w.type === 'late_night' ? '🌙' :
                       w.type === 'open_through' ? '🕐' : '⏰'}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-900">{label}</p>
                      <p className="text-xs text-amber-600 capitalize">
                        {w.type === 'all_day' ? 'All day (open to close)' :
                         w.type === 'late_night' ? 'Late night' :
                         w.type === 'open_through' ? 'Open through' : 'Happy hour'}
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

        {/* Google/Yelp links */}
        <div className="flex gap-3 mb-5">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ' ' + (venue.address_backup || ''))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            📍 Directions
          </a>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name + ' ' + (venue.address_backup || ''))}`}
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
          className="fixed inset-0 z-[200] bg-black/95 flex flex-col"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePhotoViewer()
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0">
            <button
              onClick={closePhotoViewer}
              className="flex items-center gap-2 text-white/80 hover:text-white text-sm font-medium"
            >
              ← Back
            </button>
            <span className="text-white/60 text-xs">
              {viewerPhotoIndex + 1} / {allPhotos.length}
            </span>
          </div>

          {/* Photo area */}
          <div className="flex-1 flex items-center justify-center relative">
            {/* Prev button */}
            <button
              onClick={prevPhoto}
              className="absolute left-2 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white/80 hover:text-white transition-colors"
              aria-label="Previous photo"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M12 4l-8 8 8 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div className="max-w-full max-h-full p-4 flex items-center justify-center">
              <img
                src={allPhotos[viewerPhotoIndex].url}
                alt={`Photo ${viewerPhotoIndex + 1}`}
                className="max-w-full max-h-full object-contain"
              />
            </div>

            {/* Next button */}
            <button
              onClick={nextPhoto}
              className="absolute right-2 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white/80 hover:text-white transition-colors"
              aria-label="Next photo"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 4l8 8-8 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Dots indicator */}
          <div className="flex justify-center gap-1.5 pb-6 shrink-0">
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

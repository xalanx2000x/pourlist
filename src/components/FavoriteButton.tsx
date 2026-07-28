'use client'

import { useState, useEffect, useCallback } from 'react'
import { isFavorite, toggleFavorite } from '@/lib/favorites'
import { getDeviceHash } from '@/lib/device'

interface FavoriteButtonProps {
  venueId: string
  size?: 'sm' | 'md'
}

export default function FavoriteButton({ venueId, size = 'md' }: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(false)

  // Hydrate from localStorage on mount
  useEffect(() => {
    setFavorited(isFavorite(venueId))
  }, [venueId])

  const handleClick = useCallback(async () => {
    const newState = toggleFavorite(venueId)
    setFavorited(newState)

    // Fire-and-forget tracking event
    const deviceHash = await getDeviceHash()
    fetch('/api/track-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: newState ? 'favorite' : 'unfavorite',
        deviceHash,
        venueId,
      }),
    }).catch(() => {
      // silently ignore network failures
    })
  }, [venueId])

  const iconSize = size === 'sm' ? 'text-base' : 'text-lg'
  const tapTarget = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'

  return (
    <button
      onClick={handleClick}
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      className={`${tapTarget} flex items-center justify-center rounded-full transition-all duration-150 hover:scale-110 active:scale-95 ${
        favorited
          ? 'text-red-500 hover:bg-red-50'
          : 'text-gray-400 hover:text-red-400 hover:bg-red-50'
      }`}
    >
      {favorited ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={iconSize}
          aria-hidden="true"
        >
          <path d="M11.645 20.91l-.007-.003-.022-.012a15.2 15.2 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.2 15.2 0 01-.383.219l-.022.012-.007.004-.003.001z" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={iconSize}
          aria-hidden="true"
        >
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
        </svg>
      )}
    </button>
  )
}

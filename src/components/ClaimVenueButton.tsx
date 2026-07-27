'use client'

import { useState } from 'react'
import type { Venue } from '@/lib/supabase'
import ClaimVenueModal from './ClaimVenueModal'

interface ClaimVenueButtonProps {
  venue: Venue
}

/**
 * "Claim this venue" link for the venue detail page.
 *
 * Placement: below the HH/schedule/CTA content — card footer area.
 * Visual: small muted text link. Path B (amber) palette, no purple.
 * Appears on every venue regardless of status.
 */
export default function ClaimVenueButton({ venue }: ClaimVenueButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && (
        <ClaimVenueModal
          venue={venue}
          onClose={() => setOpen(false)}
        />
      )}
      {/* // future: hide when venue is already claimed */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-xs text-gray-400 hover:text-amber-600 transition-colors underline underline-offset-2"
      >
        Own this venue? Claim this page.
      </button>
    </>
  )
}

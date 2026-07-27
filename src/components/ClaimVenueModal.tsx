'use client'

import { useState, useEffect, type FormEvent } from 'react'
import type { Venue } from '@/lib/supabase'

interface ClaimVenueModalProps {
  venue: Venue
  onClose: () => void
}

export default function ClaimVenueModal({ venue, onClose }: ClaimVenueModalProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [alreadyReceived, setAlreadyReceived] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Trap focus inside modal for accessibility
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    return () => { prev?.focus() }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/claim-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue_id: venue.id, contact_name: name, phone, email, note, _trap: honeypot }),
    })

    const data = await res.json()

    if (data.alreadyReceived) {
      setAlreadyReceived(true)
      setSubmitting(false)
      return
    }

    if (!res.ok || !data.ok) {
      setError(data.reason ?? 'Something went wrong — please try again.')
      setSubmitting(false)
      return
    }

    setSuccess(true)
    setSubmitting(false)
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-modal-title"
    >
      <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id="claim-modal-title" className="text-base font-semibold text-gray-900">
            Claim {venue.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {success ? (
            <div className="text-center py-4">
              <p className="text-base font-semibold text-gray-900 mb-1">
                Got it!
              </p>
              <p className="text-sm text-gray-600">
                We&apos;ll call your venue&apos;s listed number within 3 business days.
              </p>
            </div>
          ) : alreadyReceived ? (
            <div className="text-center py-4">
              <p className="text-base font-semibold text-gray-900 mb-1">
                We&apos;ve already got your request.
              </p>
              <p className="text-sm text-gray-600">
                We&apos;ll be in touch.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Verified profile editing, photos, and daily specials posted to your page.{' '}
                <span className="font-semibold">$49/year.</span>
              </p>

              <form onSubmit={handleSubmit} className="space-y-3" noValidate>
                {/* Honeypot — visually hidden, must stay empty */}
                <input
                  type="text"
                  name="_trap"
                  value={honeypot}
                  onChange={e => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="absolute opacity-0 pointer-events-none h-0 w-0"
                />

                <div>
                  <label htmlFor="claim-name" className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Contact name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="claim-name"
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label htmlFor="claim-phone" className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="claim-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="(503) 555-0100"
                  />
                </div>

                <div>
                  <label htmlFor="claim-email" className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="claim-email"
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="claim-note" className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Note <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <span className={`text-xs ${note.length > 240 ? 'text-amber-500' : 'text-gray-400'}`}>
                      {note.length}/280
                    </span>
                  </div>
                  <textarea
                    id="claim-note"
                    rows={3}
                    maxLength={280}
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                    placeholder="Anything else we should know?"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-500" role="alert">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors text-sm"
                >
                  {submitting ? 'Sending…' : 'Send request'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

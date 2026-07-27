'use client'

import { useState, useEffect, useCallback } from 'react'

interface ClaimRequest {
  id: string
  venueName: string
  venueCity: string
  venueState: string
  venuePhone: string | null
  contactName: string
  phone: string
  email: string
  note: string | null
  adminNote: string | null
  status: string
  createdAt: string
}

interface ApiResponse {
  claimRequests: ClaimRequest[]
  total: number
}

const STATUS_OPTIONS = [
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'verified',  label: 'Verified' },
  { value: 'closed',    label: 'Closed' },
]

function venueUrl(name: string, city: string, state: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return `/${state.toLowerCase()}/${city.toLowerCase()}/${slug}`
}

function daysAgo(dateStr: string): number {
  const then = new Date(dateStr).getTime()
  const now  = Date.now()
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

export default function VerificationClient() {
  const [claims, setClaims] = useState<ClaimRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchClaims = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/verification')
      const data: ApiResponse = await res.json()
      if (!res.ok || data.claimRequests === undefined) {
        setFetchError(data && 'reason' in data ? (data as { reason: string }).reason : 'Failed to load')
        return
      }
      setClaims(data.claimRequests)
    } catch {
      setFetchError('Network error — could not load claim requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchClaims() }, [fetchClaims])

  async function patchStatus(id: string, status: string) {
    const res = await fetch('/api/verification', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    if (res.ok) {
      setClaims(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    }
  }

  async function patchAdminNote(id: string, adminNote: string) {
    const res = await fetch('/api/verification', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, admin_note: adminNote }),
    })
    if (res.ok) {
      setClaims(prev => prev.map(c => c.id === id ? { ...c, adminNote } : c))
    }
  }

  // Split closed to bottom; keep new/contacted/verified in their returned order
  const open  = claims.filter(c => c.status !== 'closed')
  const closed = claims.filter(c => c.status === 'closed')

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900">Venue Claims</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {claims.length === 0 && !loading ? 'No claim requests.' : `${claims.length} total`}
          </p>
        </header>

        {loading && <p className="text-sm text-neutral-400">Loading…</p>}
        {fetchError && <p className="text-sm text-red-600">Error: {fetchError}</p>}

        {!loading && !fetchError && claims.length === 0 && (
          <p className="text-sm text-neutral-400">No claim requests yet.</p>
        )}

        {/* Open claims */}
        {open.length > 0 && (
          <div className="space-y-4 mb-8">
            {open.map(claim => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                onStatusChange={patchStatus}
                onAdminNoteChange={patchAdminNote}
              />
            ))}
          </div>
        )}

        {/* Closed claims */}
        {closed.length > 0 && (
          <>
            <hr className="border-neutral-200 mb-4" />
            <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Closed ({closed.length})
            </h2>
            <div className="space-y-4 opacity-60">
              {closed.map(claim => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  onStatusChange={patchStatus}
                  onAdminNoteChange={patchAdminNote}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ClaimRow({
  claim,
  onStatusChange,
  onAdminNoteChange,
}: {
  claim: ClaimRequest
  onStatusChange: (id: string, status: string) => void
  onAdminNoteChange: (id: string, note: string) => void
}) {
  const age = daysAgo(claim.createdAt)
  const stale = claim.status === 'new' && age > 2
  const isClosed = claim.status === 'closed'

  return (
    <div className={`bg-white border rounded-xl p-5 ${isClosed ? 'border-neutral-200' : 'border-neutral-200'}`}>
      {/* Venue + meta row */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-1 mb-3">
        <div>
          <a
            href={venueUrl(claim.venueName, claim.venueCity, claim.venueState)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-neutral-900 hover:text-amber-600"
          >
            {claim.venueName}
          </a>
          <span className="text-neutral-400 text-sm ml-2">
            {claim.venueCity}{claim.venueState ? `, ${claim.venueState}` : ''}
          </span>
        </div>
        <div className="text-sm text-neutral-500 space-y-0.5">
          <div>
            <span className="text-neutral-400">listed #</span>{' '}
            <span className="text-neutral-700">{claim.venuePhone ?? '—'}</span>
          </div>
          <div>
            <span className="text-neutral-400">provided #</span>{' '}
            <span className="text-neutral-700">{claim.phone}</span>
          </div>
        </div>
      </div>

      {/* Contact + note */}
      <div className="text-sm text-neutral-600 mb-3">
        <span className="font-medium">{claim.contactName}</span>
        {' · '}
        <a href={`mailto:${claim.email}`} className="text-amber-600 hover:underline">{claim.email}</a>
        {claim.note && (
          <p className="mt-1 text-neutral-500 italic">&quot;{claim.note}&quot;</p>
        )}
      </div>

      {/* Admin note */}
      <div className="mb-3">
        <label className="block text-xs text-neutral-400 mb-1">Admin note</label>
        <input
          type="text"
          defaultValue={claim.adminNote ?? ''}
          placeholder="Add a private note…"
          onBlur={e => onAdminNoteChange(claim.id, e.target.value)}
          className="w-full text-sm border border-neutral-200 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      </div>

      {/* Footer: status + age */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor={`status-${claim.id}`} className="text-xs text-neutral-400">Status</label>
          <select
            id={`status-${claim.id}`}
            value={claim.status}
            onChange={e => onStatusChange(claim.id, e.target.value)}
            className="text-sm border border-neutral-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-neutral-400">
          {claim.createdAt.slice(0, 10)}
          {stale
            ? <span className="text-red-500 font-semibold ml-1">({age}d)</span>
            : <span className="ml-1">({age}d ago)</span>
          }
        </div>
      </div>
    </div>
  )
}

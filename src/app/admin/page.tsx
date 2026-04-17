'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface Venue {
  id: string
  name: string
  address_backup: string | null
  lat: number | null
  lng: number | null
  zip: string | null
  phone: string | null
  website: string | null
  type: string | null
  status: string
  contributor_trust: string
  last_verified: string | null
  photo_count: number
  created_at: string
  menu_text: string | null
  menu_text_updated_at: string | null
  latest_menu_image_url: string | null
}

type ReviewAction = 'approve' | 'reject'

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [actioning, setActioning] = useState<string | null>(null)

  const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pourlist-admin'

  function login(e: React.FormEvent) {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setAuthed(true)
      loadVenues()
    } else {
      alert('Incorrect password')
    }
  }

  async function loadVenues() {
    setLoading(true)
    const { data } = await supabase
      .from('venues')
      .select('*')
      .in('status', ['unverified', 'verified', 'stale', 'closed'])
      .order('created_at', { ascending: false })
      .limit(50)
    setVenues((data as Venue[]) || [])
    setLoading(false)
  }

  async function handleAction(id: string, action: ReviewAction) {
    setActioning(id)
    const newStatus = action === 'approve' ? 'verified' : 'stale'
    await supabase
      .from('venues')
      .update({ status: newStatus })
      .eq('id', id)
    await loadVenues()
    setActioning(null)
  }

  const filtered = venues.filter(v => {
    if (activeTab === 'pending') return v.status === 'unverified'
    if (activeTab === 'approved') return v.status === 'verified'
    if (activeTab === 'rejected') return v.status === 'stale'
    return true
  })

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <form onSubmit={login} className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin Portal</h1>
          <p className="text-sm text-gray-500 mb-6">Enter your admin password to continue.</p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
          />
          <button
            type="submit"
            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-lg font-semibold"
          >
            Sign In
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-amber-500 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Pour List Admin</h1>
          <p className="text-amber-100 text-xs">Review and approve submitted venues</p>
        </div>
        <button
          onClick={() => setAuthed(false)}
          className="text-amber-100 hover:text-white text-sm"
        >
          Sign Out
        </button>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1">
        {(['pending', 'approved', 'rejected'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 px-4 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
            {tab === 'pending' && venues.filter(v => v.status === 'unverified').length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {venues.filter(v => v.status === 'unverified').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto p-6">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No {activeTab} venues</div>
        ) : (
          <div className="space-y-4">
            {filtered.map(venue => (
              <div key={venue.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">{venue.name}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{venue.address_backup || 'No address'}</p>
                      {venue.type && (
                        <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full mt-1">
                          {venue.type}
                        </span>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        Submitted {new Date(venue.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric'
                        })}
                        {venue.contributor_trust && ` · ${venue.contributor_trust}`}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                      venue.status === 'verified' ? 'bg-green-100 text-green-700' :
                      venue.status === 'closed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {venue.status === 'verified' ? 'approved' : venue.status}
                    </span>
                  </div>

                  {/* Menu text */}
                  {venue.menu_text && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-gray-500 mb-1">Menu Text:</p>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {venue.menu_text}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {venue.status === 'unverified' && (
                  <div className="flex border-t border-gray-100">
                    <button
                      onClick={() => handleAction(venue.id, 'approve')}
                      disabled={actioning === venue.id}
                      className="flex-1 py-3 text-sm font-semibold text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50"
                    >
                      {actioning === venue.id ? '...' : '✓ Approve'}
                    </button>
                    <button
                      onClick={() => handleAction(venue.id, 'reject')}
                      disabled={actioning === venue.id}
                      className="flex-1 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 border-l border-gray-100"
                    >
                      {actioning === venue.id ? '...' : '✕ Reject'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { checkVenueAccess } from '@/lib/venue-access'
import ManageClient from './ManageClient'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function ManagePage() {
  const venueId = await checkVenueAccess()

  if (!venueId) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900 mb-2">
            Your access link has expired or is no longer valid.
          </h1>
          <p className="text-sm text-neutral-500">
            Contact us for a new one.
          </p>
        </div>
      </div>
    )
  }

  // Fetch claimed_until for the expiry line
  const { data: venue } = await supabaseServer
    .from('venues')
    .select('claimed_until')
    .eq('id', venueId)
    .limit(1)
    .single()

  return <ManageClient venueId={venueId} claimedUntil={venue?.claimed_until ?? null} />
}

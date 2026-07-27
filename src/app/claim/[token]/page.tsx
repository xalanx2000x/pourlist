/**
 * /claim/[token] — magic-link landing route for venue owners.
 *
 * Server component: reads token, passes to client component.
 * Client component: verifies via internal API, sets cookie, redirects.
 *
 * force-dynamic: sets cookies, must never be cached.
 */
import { verifyVenueToken } from '@/lib/venue-access'
import ClaimRedirectClient from './ClaimRedirectClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ token: string }>
}

export default async function ClaimPage({ params }: Props) {
  const { token } = await params

  // Pre-verify on the server: if the token is invalid we skip client-side entirely
  const venueId = await verifyVenueToken(token)

  return <ClaimRedirectClient token={token} initialVenueId={venueId} />
}

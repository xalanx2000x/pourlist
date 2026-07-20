import { checkSeedAuth } from '@/lib/seed-auth'
import SeedLoginForm from './SeedLoginForm'
import SeedTool from './SeedTool'

/**
 * /seed — Tyler's admin god-mode tool.
 *
 * Server entry: checks the seed_session cookie. If valid, renders the tool.
 * If not, renders the password form.
 *
 * The tool has four modes:
 *   - NEW      (default)         — empty form for a fresh venue
 *   - EDIT     (?mode=edit)      — pick a venue, edit everything
 *   - GRADUATE (?mode=graduate)  — pick a seed pin, fill gaps, promote
 *   - GEOCODE  (?mode=geocode)   — pick a venue, re-run reverseGeocodeStructured
 *
 * Auth is via httpOnly cookie signed with SEED_PASSWORD (HMAC-SHA256).
 * SEED_PASSWORD itself never reaches the client.
 */
export default async function SeedPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; venueId?: string }>
}) {
  const authed = await checkSeedAuth()
  const params = await searchParams

  if (!authed) {
    return <SeedLoginForm />
  }

  const mode = params.mode === 'edit' || params.mode === 'graduate' || params.mode === 'geocode'
    ? params.mode
    : 'new'

  return <SeedTool initialMode={mode} initialVenueId={params.venueId ?? null} />
}
/**
 * /[state]/[city] — Intermediate path for the new URL structure.
 * Redirects to the home map filtered to that location.
 * Example: /or/portland → /?city=portland&state=or
 *
 * Atlantis path: /atlantis is not a real geo — redirect to home.
 */
import { redirect } from 'next/navigation'

export default async function CityPage({
  params,
}: {
  params: Promise<{ state: string; city: string }>
}) {
  const { state, city } = await params

  // /atlantis is the geo-review holding pen, not a real location — send to home
  if (state === 'atlantis') {
    redirect('/')
  }

  // Build a search-friendly redirect to the map view
  redirect(`/?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`)
}

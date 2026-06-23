/**
 * /[state] — Top-level state path.
 * Redirects to the home page filtered to that state.
 * Example: /ca → /?state=ca
 *
 * Atlantis: /atlantis → home (noindex holding pen, not a real place).
 */
import { redirect } from 'next/navigation'

export default async function StatePage({
  params,
}: {
  params: Promise<{ state: string }>
}) {
  const { state } = await params

  // /atlantis is not a real state — send to home
  if (state === 'atlantis') {
    redirect('/')
  }

  redirect(`/?state=${encodeURIComponent(state)}`)
}

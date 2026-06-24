/**
 * /[state] — Top-level state path.
 * Redirects to the home page filtered to that state.
 * Example: /ca → /?state=ca
 */
import { redirect } from 'next/navigation'

export default async function StatePage({
  params,
}: {
  params: Promise<{ state: string }>
}) {
  const { state } = await params

  redirect(`/?state=${encodeURIComponent(state)}`)
}

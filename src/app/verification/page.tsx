import { checkSeedAuth } from '@/lib/seed-auth'
import VerificationLoginForm from './VerificationLoginForm'
import VerificationClient from './VerificationClient'

/**
 * /verification — admin work page for venue claim requests.
 *
 * Auth: same seed_session cookie as /seed.
 * A session authed on /seed is already authed here.
 */
export default async function VerificationPage() {
  const authed = await checkSeedAuth()

  if (!authed) {
    return <VerificationLoginForm />
  }

  return <VerificationClient />
}

/**
 * Server-only Supabase client for build-time + ISR.
 *
 * Uses the service role key (NEVER expose to the browser). The
 * `import 'server-only'` line below causes a build error if any
 * client component accidentally pulls this in.
 *
 * Used by:
 *   - generateStaticParams in /venue/[slug]/page.tsx
 *   - /venue/[slug]/page.tsx itself
 *   - sitemap.ts
 *   - robots.ts
 *
 * Service role bypasses RLS, so this can read all venues including
 * closed ones — the page filters them out where it matters.
 */
import 'server-only'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  // Fail fast at import time so a missing env var doesn't show up as
  // a confusing 500 deep inside generateStaticParams at build time.
  throw new Error('supabase-server: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

export const supabaseServer = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
})

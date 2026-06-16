import { NextResponse, type NextRequest } from 'next/server'

/**
 * Host-redirect middleware.
 *
 * Goal: make `pourlist.app` the only public entry point. Vercel
 * auto-provisions `pourlist.vercel.app` for every project, so we
 * 301 it (and any other unknown host) to the canonical name with
 * the path preserved. This eliminates the duplicate-content issue
 * without losing inbound links to the vercel.app URL.
 *
 * Pass-through (no redirect):
 *   - pourlist.app, www.pourlist.app  — the canonical hosts
 *   - localhost, 127.0.0.1, 0.0.0.0   — local dev
 *   - *.{vercel.app}                  — Vercel preview deployments
 *                                      (must keep working — check exact
 *                                      match for pourlist.vercel.app
 *                                      first so it still gets redirected)
 *
 * Note: the existing pourlist.app → www.pourlist.app 307 is configured
 * at Vercel's edge and runs before this middleware. So this middleware
 * only ever sees www.pourlist.app on the canonical path.
 */

const CANONICAL_HOSTS = new Set(['pourlist.app', 'www.pourlist.app'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])
// Bare project alias — must be matched before the wildcard .vercel.app
// check so it gets redirected rather than passed through.
const PROJECT_VERCEL_ALIAS = 'pourlist.vercel.app'

function redirectToCanonical(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone()
  url.host = 'pourlist.app'
  url.protocol = 'https'
  return NextResponse.redirect(url, 301)
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.split(':')[0] // strip port for local dev safety

  if (CANONICAL_HOSTS.has(hostname)) return NextResponse.next()
  if (LOCAL_HOSTS.has(hostname)) return NextResponse.next()
  if (hostname === PROJECT_VERCEL_ALIAS) return redirectToCanonical(request)
  if (hostname.endsWith('.vercel.app')) return NextResponse.next() // previews

  // Safety net: any other unknown host also redirects to canonical.
  return redirectToCanonical(request)
}

export const config = {
  // Run on everything except _next internals (CDN-served, never
  // reach middleware anyway) and files with extensions (static assets).
  matcher: ['/((?!_next/|.*\\..*).*)'],
}

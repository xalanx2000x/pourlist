/**
 * Single source of truth for "is a ?venue= deep link currently in flight".
 *
 * Why a module-level flag instead of just reading the URL:
 *   The deep-link useEffect in page.tsx calls `history.replaceState` to
 *   clean `?venue=…` from the URL bar. After that, a raw URL check
 *   would return false even though the deep link is still active. We
 *   need a value that survives the URL cleanup.
 *
 * How it's used:
 *   - `getBrowserLocation` in `lib/gps.ts` reads this synchronously
 *     so the IP fallback (and the GPS success path) can't fire while a
 *     deep link owns the map position. This is the chokepoint — gating
 *     at this one place covers all three location sources (GPS success,
 *     GPS error → IP, no hardware → IP) in one shot.
 *   - The page.tsx useEffects can also call this as a synchronous
 *     belt-and-suspenders check (the URL is the source of truth on
 *     the very first render, before the module flag has been set).
 *
 * Lifecycle:
 *   - `setDeepLinkActive(true)` is called from the deep-link useEffect
 *     in page.tsx the moment `?venue=…` is detected.
 *   - `setDeepLinkActive(false)` is called when the deep link ends
 *     (bad slug / fetch error), when the user pans, when the user
 *     taps "near me", and on page unmount.
 */

let _active = false

export function setDeepLinkFlag(active: boolean): void {
  _active = active
}

export function isDeepLinkActive(): boolean {
  // Primary: the module flag (set synchronously by page.tsx).
  if (_active) return true
  // Fallback: URL check. Covers the very first render, before page.tsx
  // has had a chance to call setDeepLinkActive(true). Returns false on
  // the server (no window).
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('venue')
}

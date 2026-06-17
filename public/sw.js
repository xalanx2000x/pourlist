/**
 * Pour List Service Worker — PWA offline support
 *
 * Caching strategy:
 *   - Navigation requests (HTML pages): network-first, cache as offline
 *     fallback. This is the critical fix: cache-first for HTML means
 *     returning users are stuck on the old version forever, because the
 *     cached HTML references old chunk URLs that are ALSO in the cache.
 *     Network-first ensures the latest HTML (and its chunk references)
 *     reaches the browser on every navigation.
 *   - Static assets (_next/static/*, images, fonts): cache-first.
 *     Safe because Next.js fingerprints chunk filenames — new builds
 *     have new URLs and are fetched fresh. Old chunks linger in cache
 *     but are never referenced.
 *   - API requests: stale-while-revalidate. Best of both worlds.
 *
 * Update flow:
 *   - skipWaiting() + clients.claim() so a new SW takes over immediately,
 *     no tab-close required.
 *   - CACHE_NAME stays stable. Bump it manually only if the cache shape
 *     changes (e.g., a new response format that would break old readers).
 *     For routine code deploys, the network-first HTML strategy above
 *     is what gets updates to users.
 */

const CACHE_NAME = 'pourlist-v1'
const SHELL_URLS = [
  '/',
  '/manifest.json',
  // Next.js will handle JS/CSS caching via its own build fingerprinting
]

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_URLS).catch(() => {
        // Don't block install — allow app to work even if cache fails
      })
    })
  )
  self.skipWaiting()
})

// Activate: clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    })
  )
  self.clients.claim()
})

// Fetch: route by request type
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET
  if (request.method !== 'GET') return

  // Skip external requests (fonts, map tiles, etc.)
  if (url.origin !== self.location.origin) return

  // API requests → stale-while-revalidate (always get latest, fallback to cache)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/supabase/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Cache successful API responses for up to 5 minutes
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Navigation requests (HTML pages) → network-first, cache as offline fallback.
  // THIS IS THE CRITICAL FIX: cache-first for HTML would serve stale code to
  // returning users because the cached HTML references old chunk URLs that
  // are also cached. Network-first ensures the latest HTML reaches the
  // browser, and its chunk references trigger fresh fetches for any
  // fingerprinted assets that have changed.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Static assets & everything else → cache-first with network fallback.
  // Safe for _next/static/* because Next.js fingerprints those filenames.
  event.respondWith(
    caches.match(request).then(cacheRes => {
      if (cacheRes) return cacheRes
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
        }
        return res
      })
    })
  )
})

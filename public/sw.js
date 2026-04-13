/**
 * Pour List Service Worker — PWA offline support
 * Caches the app shell + last venue list so the app loads without network.
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

// Fetch: stale-while-revalidate for venue API, cache-first for everything else
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

  // Static assets & pages → cache-first with network fallback
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
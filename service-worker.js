const CACHE_NAME = 'minish-tracker-v10'
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=10',
  './platform.js?v=8',
  './supabase-config.js?v=4',
  './renderer.js?v=10',
  './minish-core.js?v=10',
  './finance.js?v=10',
  './manifest.webmanifest',
  './fonts/PretendardVariable.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png'
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('minish-tracker-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url)
  if (requestUrl.hostname.endsWith('.supabase.co')) return
  if (event.request.method !== 'GET') return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy))
          return response
        })
        .catch(() => caches.match('./index.html'))
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
      }
      return response
    }))
  )
})

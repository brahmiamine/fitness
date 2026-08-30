const CACHE_NAME = 'pulse-shell-v2'
const APP_SHELL = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
]

function builtAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], self.registration.scope))
    .filter((url) => url.origin === self.location.origin && url.pathname.includes('/assets/'))
    .map((url) => url.href)
}

async function nestedAssets(urls, cache) {
  const discovered = new Set()
  for (const url of urls.filter((value) => value.endsWith('.js'))) {
    const response = await cache.match(url)
    if (!response) continue
    const source = await response.text()
    for (const match of source.matchAll(/["'`]([^"'`]*\/assets\/[^"'`]+\.wasm)["'`]/g)) {
      const asset = new URL(match[1], self.registration.scope)
      if (asset.origin === self.location.origin) discovered.add(asset.href)
    }
  }
  return [...discovered]
}

async function cacheDocument(response) {
  const cache = await caches.open(CACHE_NAME)
  const html = await response.clone().text()
  const assets = builtAssets(html)
  await cache.addAll(assets)
  const dependencies = await nestedAssets(assets, cache)
  await Promise.all([
    cache.put('./index.html', response.clone()),
    cache.put('./', response.clone()),
    cache.addAll(dependencies),
  ])
}

async function precache() {
  const cache = await caches.open(CACHE_NAME)
  await cache.addAll(APP_SHELL)
  const response = await fetch('./index.html', { cache: 'reload' })
  if (!response.ok) throw new Error('App shell unavailable')
  await cacheDocument(response)
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(self.registration.scope.replace(url.origin, ''))) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) await cacheDocument(response)
          return response
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})

const entries = self.__WB_MANIFEST
const assetPrefix = 'mr-saloum-assets-v1-'
const shellCache = 'mr-saloum-shell-v1'
const origin = self.location.origin
const assets = entries.map(({ url }) => new URL(url, self.registration.scope).href)
const fingerprint = entries.map(({ url, revision }) => revision || url).join('|')
let hash = 0
for (const character of fingerprint) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
const currentAssets = assetPrefix + hash.toString(36)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(currentAssets).then((cache) =>
    cache.addAll(assets.map((url) => new Request(url, { cache: 'reload' })))
  ))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const oldAssets = (await caches.keys()).filter((key) => key.startsWith(assetPrefix) && key !== currentAssets)
    await Promise.all(oldAssets.slice(0, -2).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
})

async function navigation(request, url) {
  const cache = await caches.open(shellCache)
  try {
    let response = await fetch(new Request(request, { cache: 'no-store' }))
    if (response.status === 404 && ['/admin', '/admin/'].includes(url.pathname)) {
      response = await fetch(new URL('/admin/index.html', origin), { cache: 'no-store', credentials: 'same-origin' })
    }
    if (response.ok && !response.redirected && response.headers.get('content-type')?.includes('text/html') &&
        !/private|no-store/i.test(response.headers.get('cache-control') || '')) {
      await cache.put(url.href, response.clone()).catch(() => {})
    }
    return response
  } catch {
    return (await cache.match(url.href)) ?? Response.error()
  }
}

async function asset(request) {
  const keys = (await caches.keys()).filter((key) => key.startsWith(assetPrefix)).reverse()
  for (const key of keys) {
    const response = await (await caches.open(key)).match(request)
    if (response) return response
  }
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== origin || url.search || request.headers.has('authorization')) return
  if (request.mode === 'navigate' && ['/', '/admin', '/admin/', '/admin/index.html'].includes(url.pathname)) {
    event.respondWith(navigation(request, url))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request))
  }
})

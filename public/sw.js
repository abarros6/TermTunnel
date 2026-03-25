const CACHE_NAME = 'termtunnel-v3';
const STATIC_ASSETS = ['/manifest.json'];
const NETWORK_FIRST = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and WebSocket requests
  if (request.method !== 'GET') return;
  if (request.url.startsWith('ws://') || request.url.startsWith('wss://')) return;
  if (new URL(request.url).pathname === '/ws') return;

  const pathname = new URL(request.url).pathname;
  const isStatic = STATIC_ASSETS.some((path) => pathname === path);
  const isNetworkFirst = NETWORK_FIRST.some((path) => pathname === path);

  if (isNetworkFirst) {
    // Network-first for HTML — always serve fresh code, fall back to cache offline
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
  } else if (isStatic) {
    // Cache-first for static assets (manifest, icons)
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  } else {
    // Network-first with cache fallback for everything else
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});

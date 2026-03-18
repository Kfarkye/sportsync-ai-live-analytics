// ============================================================================
// SERVICE WORKER — SportSync AI (Offline Shell)
// ============================================================================
// Strategy: Network-first for API data, Cache-first for static assets.
// This gives the app installability + instant shell on repeat visits.
// ============================================================================

const CACHE_NAME = 'sportsync-v5';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

const safeCachePut = async (cache, request, response) => {
  try {
    await cache.put(request, response);
  } catch {
    // Ignore cache write failures in low-storage/degraded environments.
  }
};

const safeCacheMatch = async (request) => {
  try {
    return await caches.match(request) || undefined;
  } catch {
    return undefined;
  }
};

// Install — cache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch(() => Promise.resolve())
    )
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key.startsWith('sportsync-'))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — Network-first for API, Cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  const acceptsHtml = request.headers.get('accept')?.includes('text/html');
  if (request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => safeCachePut(cache, request, clone)).catch(() => {
            // Ignore cache write failures for degraded storage.
          });
          return response;
        })
        .catch(() =>
          Promise.all([
            safeCacheMatch(request),
            safeCacheMatch(new Request('/index.html'))
          ]).then(([cached, fallback]) => cached || fallback)
        )
    );
    return;
  }

  // API calls: network-first
  if (url.pathname.startsWith('/api') || url.hostname !== location.hostname) {
    event.respondWith(
      fetch(request).catch(() => safeCacheMatch(request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    safeCacheMatch(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => safeCachePut(cache, request, clone)).catch(() => {
            // Ignore cache write failures for degraded storage.
          });
        }
        return response;
      });
    })
  );
});

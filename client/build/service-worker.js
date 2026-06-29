const CACHE_NAME = 'gshop-v11';
const STATIC_CACHE = 'gshop-static-v11';
const API_CACHE = 'gshop-api-v11';
const MAX_STATIC_ITEMS = 100;
const MAX_API_ITEMS = 20;
const API_CACHE_MAX_AGE_MS = 60 * 1000; // 60 seconds max for API responses

const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo-icon.png',
  '/logo.png'
];

// Install: cache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Helper: safely cache a cloned response
function cacheResponse(cacheName, request, response) {
  const clone = response.clone();
  caches.open(cacheName).then((cache) => {
    cache.put(request, clone);
  }).catch((err) => {
    console.error('[SW] Cache put failed:', err);
  });
}

// Helper: limit cache size by removing oldest entries
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map((req) => cache.delete(req)));
  }
}

// Helper: check if cached API response is still fresh
async function isCacheFresh(cachedResponse) {
  if (!cachedResponse) return false;
  const dateHeader = cachedResponse.headers.get('date');
  if (!dateHeader) return false;
  const cachedAt = new Date(dateHeader).getTime();
  return Date.now() - cachedAt < API_CACHE_MAX_AGE_MS;
}

// Fetch with proper strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Helper: clone request with ngrok skip header to bypass interstitial
  function bypassNgrok(request) {
    const headers = new Headers(request.headers);
    headers.set('ngrok-skip-browser-warning', 'true');
    return new Request(request, { headers });
  }

  // 1. API calls: network-first with short-lived cache, no offline fallback for mutations
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(bypassNgrok(request))
        .then((response) => {
          // Detect ngrok interstitial or HTML error pages
          const contentType = response.headers.get('content-type') || '';
          const isHtml = contentType.includes('text/html');
          const ngrokError = response.headers.get('ngrok-error-code');
          if (isHtml || ngrokError) {
            // Don't cache HTML responses for API calls
            return response;
          }
          if (request.method === 'GET' && response.ok) {
            // Only cache API GETs briefly; still serve stale if offline
            cacheResponse(API_CACHE, request, response);
            trimCache(API_CACHE, MAX_API_ITEMS);
          }
          return response;
        })
        .catch((err) => {
          return caches.match(request).then((cached) => {
            // Guard: never return a cached HTML page for an API call
            if (cached) {
              const ct = cached.headers.get('content-type') || '';
              if (!ct.includes('text/html')) return cached;
            }
            return new Response(JSON.stringify({ error: 'Network error — please check your connection and try again.' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // 2. Static assets (JS/CSS/images): stale-while-revalidate
  if (
    url.pathname.startsWith('/static/') ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|ico)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            cacheResponse(STATIC_CACHE, request, networkResponse);
            trimCache(STATIC_CACHE, MAX_STATIC_ITEMS);
          }
          return networkResponse;
        }).catch(() => null);

        // Return cached immediately if available, otherwise wait for network
        if (cached) return cached;
        return networkFetch.then((res) => {
          if (res) return res;
          return new Response('Network error', {
            status: 408,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
    );
    return;
  }

  // 3. HTML / navigation: network-first (critical for new builds)
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            cacheResponse(CACHE_NAME, request, response);
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match('/index.html').then((fallback) => {
              if (fallback) return fallback;
              return new Response('Offline - no cached page', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
              });
            });
          });
        })
    );
    return;
  }

  // 4. Everything else: try cache, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

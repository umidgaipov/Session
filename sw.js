/* ==========================================================================
   Session — Statistics Mobile Test Platform
   Service Worker (Cache-First / Subway Offline-First)
   Cache Name: session-stat-v1
   ========================================================================== */

const CACHE_NAME = 'session-stat-v2';

// Essential local application shell and datasets (atomic pre-cache)
const CORE_PRECACHE_ASSETS = [
  './',
  'index.html',
  'site.webmanifest',
  'assets/css/styles.css',
  'assets/js/app.js',
  'assets/icons/favicon.svg',
  'assets/icons/favicon-32x32.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'situational_tests.json',
  'practical_tests.json'
];

// Optional external assets (Google Fonts stylesheet)
const EXTERNAL_PRECACHE_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

/* --------------------------------------------------------------------------
   1. INSTALL LIFECYCLE
   - Pre-caches core application assets atomically.
   - Gracefully attempts to pre-cache font stylesheet without aborting install on network fail.
   - Calls skipWaiting() to activate immediately.
   -------------------------------------------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // 1. Atomic pre-cache of local essential resources
        await cache.addAll(CORE_PRECACHE_ASSETS);

        // 2. Resilient pre-cache for external fonts
        for (const fontUrl of EXTERNAL_PRECACHE_ASSETS) {
          try {
            await cache.add(fontUrl);
          } catch (err) {
            console.warn('[SW] Optional pre-cache font skipped:', fontUrl, err);
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});

/* --------------------------------------------------------------------------
   2. ACTIVATE LIFECYCLE
   - Cleans up legacy/stale caches from previous versions.
   - Calls clients.claim() to immediately control active pages.
   -------------------------------------------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log('[SW] Purging outdated cache:', name);
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

/* --------------------------------------------------------------------------
   3. FETCH LIFECYCLE (Cache-First with Network Fallback)
   - Only intercepts GET requests over http/https protocols.
   - Cache-First: serves matching cached response instantly (0ms latency).
   - Network Fallback: fetches from network and dynamically caches successful responses.
   - Offline Navigation Fallback: routes failed navigations to cached index.html.
   -------------------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Skip browser extensions, chrome-extension://, file://, etc.
  if (!url.protocol.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. Cache hit: return immediately
      if (cachedResponse) {
        return cachedResponse;
      }

      // 2. Cache miss: fetch from network
      return fetch(event.request)
        .then((networkResponse) => {
          // Verify valid response before caching
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch((error) => {
          // 3. Network failed (offline): handle navigation fallback
          if (event.request.mode === 'navigate') {
            return caches.match('index.html').then((indexFallback) => {
              return indexFallback || caches.match('./');
            });
          }
          throw error;
        });
    })
  );
});

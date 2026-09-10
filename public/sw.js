// public/sw.js
// Progressive Web App Service Worker for Nhovem Cabahug's Portfolio
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `nhovem-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `nhovem-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/tavern',
  '/quests',
  '/simple',
  '/offline',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png'
];

// Install Event: pre-cache critical app shell and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Use Promise.allSettled so a single missing asset doesn't abort SW installation
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'no-cache' }).then((response) => {
            if (response.ok) {
              return cache.put(url, response);
            }
          }).catch((err) => {
            console.warn(`[SW] Pre-cache miss for ${url}:`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: purge older cache generations and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('nhovem-') && name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log(`[SW] Purging outdated cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Only handle GET requests; never touch POST (e.g. Web3Forms Raven contact form)
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 2. Pass through dynamic external APIs without caching
  if (url.hostname.includes('api.web3forms.com') || url.hostname.includes('api.github.com')) {
    return;
  }

  // 3. Navigation requests: Network-First with Cache Fallback -> Custom Offline Page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // If neither network nor cache matched, serve the thematic offline page
          const offlinePage = await caches.match('/offline');
          return offlinePage || Response.error();
        })
    );
    return;
  }

  // 4. Static Assets (CSS, JS, Fonts, Images, Audio, WebManifest): Stale-While-Revalidate
  const isStaticAsset =
    url.origin === self.location.origin ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            // Network failure is fine for stale-while-revalidate; cached copy will serve
            return null;
          });

        return cachedResponse || fetchPromise.then((res) => res || caches.match('/favicon.svg'));
      })
    );
  }
});

// Message listener for skipWaiting trigger
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

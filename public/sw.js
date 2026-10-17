// public/sw.js
// Progressive Web App Service Worker for Nhovem Cabahug's Portfolio
const CACHE_VERSION = 'v7';
const STATIC_CACHE = `nhovem-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `nhovem-runtime-${CACHE_VERSION}`;
const MAX_RUNTIME_ENTRIES = 60;

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

async function putInRuntimeCache(request, response) {
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME_ENTRIES) {
    const excess = keys.length - MAX_RUNTIME_ENTRIES;
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

// Install Event: pre-cache critical app shell; wait for client coordination before skipping waiting over an active controller (UX-07)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
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
    })
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
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Only handle GET requests; never touch POST/PUT/DELETE
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 2. Never intercept local /api/* routes or dynamic external APIs
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('api.web3forms.com') ||
    url.hostname.includes('api.github.com') ||
    url.hostname.includes('challenges.cloudflare.com') ||
    url.hostname.includes('cloudflare-dns.com')
  ) {
    return;
  }

  // 3. Navigation & HTML requests (including Astro ClientRouter page swaps): Network-First
  const isHtmlRequest =
    request.mode === 'navigate' ||
    (request.headers.get('accept') && request.headers.get('accept').includes('text/html'));

  if (isHtmlRequest) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            event.waitUntil(putInRuntimeCache(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          const offlinePage = await caches.match('/offline');
          return offlinePage || Response.error();
        })
    );
    return;
  }

  // 4. Static Assets (CSS, JS, Fonts, Images, Audio, WebManifest): Stale-While-Revalidate
  const isStaticAsset =
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/art/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/audio/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.webmanifest') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              event.waitUntil(putInRuntimeCache(request, clone));
            }
            return networkResponse;
          })
          .catch(() => null);

        return cachedResponse || fetchPromise.then((res) => res || caches.match('/favicon.svg'));
      })
    );
  }
});

// Message listener for explicit client-approved skipWaiting trigger
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

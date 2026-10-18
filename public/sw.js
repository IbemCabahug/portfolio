// public/sw.js
// Progressive Web App Service Worker for Nhovem Cabahug's Portfolio
const CACHE_VERSION = 'v8';
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

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 2. Explicit origin boundary (PLAN-08):
  // Cache ONLY same-origin requests or specifically allowlisted external font hosts.
  // Bypass all other cross-origin requests immediately (e.g. Turnstile, Web3Forms, Resend, GitHub).
  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedExternalFont =
    url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  if (!isSameOrigin && !isAllowedExternalFont) {
    return;
  }

  // 3. Never intercept local /api/* endpoints
  if (isSameOrigin && url.pathname.startsWith('/api/')) {
    return;
  }

  // 4. Navigation & HTML requests (Network-First)
  const isHtmlRequest =
    request.mode === 'navigate' ||
    (request.headers.get('accept') && request.headers.get('accept').includes('text/html'));

  if (isSameOrigin && isHtmlRequest) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheControl = (networkResponse.headers.get('cache-control') || '').toLowerCase();
            if (!cacheControl.includes('no-store') && !cacheControl.includes('private')) {
              const clone = networkResponse.clone();
              event.waitUntil(putInRuntimeCache(request, clone));
            }
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse =
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(url.pathname));
          if (cachedResponse) {
            return cachedResponse;
          }
          const offlinePage = await caches.match('/offline');
          return offlinePage || Response.error();
        })
    );
    return;
  }

  // 5. Static Assets (CSS, JS, Fonts, Images, Audio, WebManifest): Stale-While-Revalidate
  const isStaticAsset =
    isAllowedExternalFont ||
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
    url.pathname.endsWith('.webmanifest');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const cacheControl = (networkResponse.headers.get('cache-control') || '').toLowerCase();
              if (!cacheControl.includes('no-store') && !cacheControl.includes('private')) {
                const clone = networkResponse.clone();
                event.waitUntil(putInRuntimeCache(request, clone));
              }
            }
            return networkResponse;
          })
          .catch(() => null);

        return (
          cachedResponse ||
          fetchPromise.then((res) => {
            if (res) return res;
            if (url.pathname.endsWith('.svg') || url.pathname.endsWith('.png')) {
              return caches.match('/favicon.svg');
            }
            return Response.error();
          })
        );
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

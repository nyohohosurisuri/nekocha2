
const CACHE_NAME = 'ai-chat-v31-pwa-query'; // バージョンを更新
const ASSETS = [
  './',
  './index.html',
  'index.html', // Add exact match
  './index.tsx',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Navigation requests: always serve index.html (SPA/PWA pattern)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Preload check
          const preloadResp = await event.preloadResponse;
          if (preloadResp) return preloadResp;

          // Try caching strategies (ignore search params to hit index.html cache)
          const cachedResp = await caches.match(event.request, { ignoreSearch: true });
          if (cachedResp) return cachedResp;

          // Network fallback for navigation
          const networkResp = await fetch(event.request);
          return networkResp;
        } catch (e) {
          // Offline/Fail: Return cached index.html
          const fallback = await caches.match('./index.html', { ignoreSearch: true })
            || await caches.match('index.html', { ignoreSearch: true });
          return fallback;
        }
      })()
    );
    return;
  }

  // Asset requests: Stale-while-revalidate / Cache first
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response immediately if available
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Cache the new response for next time
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Network failed, nothing to do (we returned cache already if existed)
      });

      return cachedResponse || fetchPromise;
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

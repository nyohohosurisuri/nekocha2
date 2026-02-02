// SW Emergency Reset
const CACHE_NAME = 'check-v' + Date.now();

self.addEventListener('install', (event) => {
  self.skipWaiting();
  console.log('SW: Installing emergency reset...');
});

self.addEventListener('activate', (event) => {
  console.log('SW: Activating emergency reset...');
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => {
        console.log('SW: All caches deleted.');
        return self.registration.unregister();
      })
      .then(() => {
        console.log('SW: Unregistered.');
        return self.clients.matchAll({ type: 'window' });
      })
      .then((clients) => {
        console.log('SW: Reloading clients...');
        clients.forEach((client) => client.navigate(client.url));
      })
  );
});

self.addEventListener('fetch', (event) => {
  // Pass through everything to network
  event.respondWith(fetch(event.request));
});

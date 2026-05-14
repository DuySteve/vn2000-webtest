const CACHE_NAME = 'vn2000-web-v57';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/provinces.js',
  './js/converter.js',
  './js/utils.js',
  './js/map.js',
  './js/main.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Bỏ qua map tiles
  if (event.request.url.includes('mt.google.com')) {
    return;
  }
  
  // Chiến lược: Network First, Fallback to Cache
  // Giúp trình duyệt luôn lấy bản mới nhất khi F5, chỉ dùng Cache khi mất mạng
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      // Lưu bản mới nhất vào cache
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
      }
      return networkResponse;
    }).catch(() => {
      // Nếu lỗi mạng, lấy từ cache
      return caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || caches.match('./index.html');
      });
    })
  );
});

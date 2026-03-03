const CACHE_NAME = 'monicoffee-v1';
const ASSETS_TO_CACHE = [
    '/kopi/',
    '/kopi/index.html',
    '/kopi/styles.css',
    '/kopi/app.js',
    '/kopi/supabase.js',
    '/kopi/config.js',
    '/kopi/bg-removal.js',
    '/kopi/manifest.json',
    '/kopi/icons/icon-192.png',
    '/kopi/icons/icon-512.png'
];

// Install — cache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE).catch(err => {
                console.warn('Cache addAll failed for some assets:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — network-first strategy (so data stays fresh)
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests and Supabase API calls
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('supabase.co')) return;
    if (event.request.url.includes('cdn.jsdelivr.net')) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone and cache the fresh response
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // Fallback to cache when offline
                return caches.match(event.request);
            })
    );
});

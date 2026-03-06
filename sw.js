const CACHE_NAME = 'monicoffee-v2';
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

// Fetch — smart caching strategy
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip Supabase API calls — always go to network for fresh data
    if (event.request.url.includes('supabase.co')) return;

    const url = new URL(event.request.url);

    // --- STRATEGY 1: Stale-While-Revalidate for app shell assets ---
    // Returns cache immediately for instant load, updates cache in background
    const isAppShell = ASSETS_TO_CACHE.some(asset => url.pathname.endsWith(asset) || url.pathname === asset);
    if (isAppShell) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchPromise = fetch(event.request).then((networkResponse) => {
                        if (networkResponse && networkResponse.ok) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => cachedResponse); // Fallback to cache if network fails

                    // Return cached version immediately, update in background
                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // --- STRATEGY 2: Cache-first for @imgly WASM/ML model files ---
    // These are large, versioned files that don't change — cache aggressively
    if (event.request.url.includes('cdn.jsdelivr.net') && event.request.url.includes('@imgly')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    return fetch(event.request).then((networkResponse) => {
                        if (networkResponse && networkResponse.ok) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

    // --- STRATEGY 3: Skip other CDN requests (Supabase JS, fonts, icons) ---
    if (event.request.url.includes('cdn.jsdelivr.net')) return;
    if (event.request.url.includes('fonts.googleapis.com')) return;
    if (event.request.url.includes('fonts.gstatic.com')) return;
    if (event.request.url.includes('unpkg.com')) return;

    // --- STRATEGY 4: Stale-While-Revalidate for everything else ---
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.ok) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => cachedResponse);

                return cachedResponse || fetchPromise;
            });
        })
    );
});

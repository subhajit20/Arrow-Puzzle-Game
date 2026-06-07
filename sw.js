// =============================================================================
// sw.js — Service Worker for VECTO PWA
//
// Strategy: Cache-first for all game assets (JS, HTML, CSS).
// On first visit, all assets are pre-cached so the game works offline.
// On update, the new service worker waits until all tabs are closed,
// then activates and replaces the old cache.
// =============================================================================

const CACHE_NAME = 'vecto-v1';

const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './js/Grid.js',
    './js/Path.js',
    './js/SolvabilityOracle.js',
    './js/ZoneMap.js',
    './js/RCBuilder.js',
    './js/DifficultyEngine.js',
    './js/Validator.js',
    './js/Generator.js',
    './js/Camera.js',
    './js/Renderer.js',
    './js/AnimationEngine.js',
    './js/InputHandler.js',
    './js/AudioEngine.js',
    './js/GameController.js',
    './js/Persistence.js',
    './js/BoardLoader.js',
    './js/DailyPuzzle.js',
    './js/GridShape.js',
    './js/boards-data.js',
    './js/main.js',
];

// ── Install — pre-cache all game assets ──────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// ── Activate — remove old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch — cache-first, fall back to network ─────────────────────────────────
self.addEventListener('fetch', event => {
    // Only handle same-origin requests and skip non-GET
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                // Cache successful responses for game assets
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

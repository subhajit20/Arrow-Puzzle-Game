// =============================================================================
// sw.js — Service Worker for VECTO PWA
//
// Strategy: Cache-first for all game assets (JS, HTML, CSS).
// On first visit, all assets are pre-cached so the game works offline.
// On update, skipWaiting() + clients.claim() forces the new SW to activate
// immediately so users always get the latest files on next reload.
// =============================================================================

const CACHE_NAME = 'vecto-v9';

const PRECACHE_URLS = [
    './',
    './index.html',
    './game.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    // Foundation
    './js/Grid.js',
    './js/Path.js',
    './js/SolvabilityOracle.js',
    // Generation core
    './js/ZoneMap.js',
    './js/RCBuilder.js',
    './js/DifficultyEngine.js',
    './js/Validator.js',
    './js/GridShape.js',
    // Pipeline blueprint
    './js/BoardBlueprint.js',
    './js/PipelineConfig.js',
    // Pipeline stages 2-3
    './js/RegionLayout.js',
    './js/RegionConnectivity.js',
    // Pipeline stages 4-5
    './js/TopologyGenerator.js',
    './js/MotifAssigner.js',
    // Pipeline stages 6-8
    './js/MotifSkeletonGenerator.js',
    './js/RegionNodeGraphBuilder.js',
    './js/GlobalNodeGraphBuilder.js',
    // Pipeline stages 9-12
    './js/PathRouter.js',
    './js/PathInteractionDetector.js',
    './js/DependencyGraphBuilder.js',
    './js/SolveOrderPlanner.js',
    // Pipeline stage 18
    './js/BoardRepairer.js',
    './js/Generator.js',
    // Presentation
    './js/Camera.js',
    './js/Renderer.js',
    './js/AnimationEngine.js',
    // Interaction
    './js/InputHandler.js',
    './js/AudioEngine.js',
    './js/GameController.js',
    // Integration
    './js/Persistence.js',
    './js/BoardLoader.js',
    './js/DailyPuzzle.js',
    './js/boards-data.js',
    './js/main.js',
];

// ── Install — pre-cache all game assets ──────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                const requests = PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' }));
                return cache.addAll(requests);
            })
            .then(() => self.skipWaiting())   // activate immediately, don't wait
    );
});

// ── Activate — delete all old caches, claim all clients ──────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())  // take control of all open tabs now
    );
});

// ── Fetch — cache-first, fall back to network ─────────────────────────────────
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

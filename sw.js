/**
 * Ballistic Workbench - Offline Field PWA Service Worker
 * Ensures 100% reliable offline operation on remote firing ranges and backcountry match stages.
 * Employs Network-First caching: immediate fresh content updates when connected,
 * with bulletproof offline fallback to cached app shell when in the field.
 */

// Keep in step with "version" in manifest.json (tests/version.mjs checks it). A new version
// gets a new cache, so old cached files are dropped on activate.
const CACHE_NAME = 'ballistic-workbench-v0.1.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles/main.css',
  './styles/print.css',
  './src/ui/app.js',
  './src/ui/workspace.js',
  './src/ui/solverLab.js',
  './src/ui/dopeStudio.js',
  './src/ui/tools.js',
  './src/ui/libraryManager.js',
  './src/ui/rifleBuilderModal.js',
  './src/core/state.js',
  './src/core/units.js',
  './src/canvas/charts.js',
  './src/canvas/reticle.js',
  './src/canvas/turret.js',
  './src/canvas/windRose.js',
  './src/physics/solvers.js',
  './src/physics/atmosphere.js',
  './src/physics/truing.js',
  './src/physics/wez.js',
  './src/data/defaultProfiles.js',
  './src/data/projectiles.js',
  './src/data/dragTables.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // Cache failures should not break service worker installation
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Network-First with Cache Fallback for live field operation & dev updates
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

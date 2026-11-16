/**
 * Ballistic Workbench - service worker for offline use.
 * Network first (fresh files when online), falling back to the cache offline. Only same-origin
 * GET responses are cached; query strings are ignored; navigations fall back to the app shell.
 * tests/sw-assets.mjs checks that STATIC_ASSETS lists every app file.
 */

// Keep in step with "version" in manifest.json (tests/version.mjs checks it). A new version
// gets a new cache, so old cached files are dropped on activate.
const CACHE_NAME = 'ballistic-workbench-v0.1.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/art.svg',
  './assets/favicon.svg',
  './assets/guide-art.svg',
  './assets/icons.svg',
  './src/canvas/charts.js',
  './src/canvas/palette.js',
  './src/canvas/reticle.js',
  './src/canvas/turret.js',
  './src/canvas/windRose.js',
  './src/core/escape.js',
  './src/core/sanitize.js',
  './src/core/state.js',
  './src/core/targets.js',
  './src/core/trajectory.js',
  './src/core/units.js',
  './src/data/defaultProfiles.js',
  './src/data/dragTables.js',
  './src/data/projectiles.js',
  './src/physics/atmosphere.js',
  './src/physics/solvers.js',
  './src/physics/truing.js',
  './src/physics/wez.js',
  './src/physics/fit.js',
  './src/physics/hunting.js',
  './src/core/share.js',
  './src/ui/app.js',
  './src/ui/dopeStudio.js',
  './src/ui/fields.js',
  './src/ui/guide.js',
  './src/ui/help.js',
  './src/ui/helpContent.js',
  './src/ui/icons.js',
  './src/ui/libraryManager.js',
  './src/ui/notify.js',
  './src/ui/rifleBuilderModal.js',
  './src/ui/solverLab.js',
  './src/ui/tools.js',
  './src/ui/workspace.js',
  './styles/main.css',
  './styles/print.css',
  './styles/views/dope.css',
  './styles/views/guide.css',
  './styles/views/lab.css',
  './styles/views/library.css',
  './styles/views/tools.css',
  './vendor/lada-glass/2.2.0/lada-glass.css',
  './vendor/lada-glass/2.2.0/lada-glass.js',
  './vendor/qrcode-generator/2.0.4/qrcode.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache other sites
  const cacheKey = url.origin + url.pathname; // ignore query strings

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(cacheKey);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match(new URL('./index.html', self.location).href);
        return Response.error();
      })
  );
});

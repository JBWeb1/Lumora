// Lumora service worker: offline support and self-updating.
//
// How updates work: every release changes VERSION below. Browsers re-check this file
// in the background; when its bytes change, the new worker downloads the complete new
// version into a fresh cache while the current one keeps running. The page is then
// told an update is ready and switches over (immediately when idle, or when the user
// agrees if they have work open). Old caches are deleted afterwards.

const VERSION = '0.4.0';
const CACHE = `lumora-${VERSION}`;

// Everything the app needs to run offline. `npm test` checks this list is complete.
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/logo-32.png',
  './assets/logo-64.png',
  './assets/logo-192.png',
  './assets/logo-512.png',
  './src/app.js',
  './src/version.js',
  './src/core/ask.js',
  './src/core/chartspec.js',
  './src/core/clean.js',
  './src/core/csv.js',
  './src/core/drivers.js',
  './src/core/formula.js',
  './src/core/infer.js',
  './src/core/insights.js',
  './src/core/learn.js',
  './src/core/project.js',
  './src/core/samples.js',
  './src/core/significance.js',
  './src/core/stats.js',
  './src/core/transform.js',
  './src/core/xlsx.js',
  './src/ui/charts.js',
  './src/ui/dom.js',
  './src/ui/export.js',
  './src/ui/storage.js',
  './src/ui/updates.js',
];

self.addEventListener('install', (event) => {
  // `cache: 'reload'` skips the browser's HTTP cache so we never store a stale file.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lumora-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Page loads (including ?sample=… links) always get this version's index.html.
    if (request.mode === 'navigate') {
      return (await cache.match('./index.html')) ?? fetch(request);
    }
    return (await cache.match(request, { ignoreSearch: true })) ?? fetch(request);
  })());
});

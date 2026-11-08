// Offline support: keep the app's files cached; update in the background when online.
const CACHE = 'hanglish-v2';
const FILES = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/core.js', 'js/render.js', 'js/keyboard.js',
  'data/syllabary-font-data.json', 'fonts/SyllabarySerif-Regular.ttf', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Serve from the cache straight away, and refresh the cached copy from the network.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((r) => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});

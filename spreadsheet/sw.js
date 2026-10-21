// Offline support: network first (so updates and reverts arrive on the next online launch), cache as fallback.
const CACHE = 'spreadsheet-v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/engine.js', 'js/icons.js', 'js/app.js', 'vendor/xlsx.full.min.js',
  'img/icon.svg', 'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('spreadsheet-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});

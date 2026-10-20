// Opens offline and stays fresh: always try the network first, fall back to the saved copy.
const CACHE = 'lh-lister-v7';
const SHELL = ['./', 'index.html', 'phone.css', 'phone.js', 'cloud.js', 'config.js', 'manifest.webmanifest', 'icons/icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // cloud calls go straight to Supabase
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

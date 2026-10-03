/* Music Making App service worker — precaches the whole app shell for offline use.
   VERSION changes whenever any shipped file changes, which triggers the in-app "new version" prompt. */
const VERSION = '6d3d6ad34a';
const CACHE = 'music-app-' + VERSION;
const ASSETS = ["./","index.html","manifest.webmanifest","icons/apple-touch-icon.png","icons/favicon-16.png","icons/favicon-32.png","icons/favicon.ico","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-192.png","icons/icon-maskable-512.png","icons/og-image.png"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('music-app-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/sw.js')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
      try { return await fetch(req); } catch (err) { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

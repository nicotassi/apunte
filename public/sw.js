// Apunte: cache de la app para abrir rápido y sin conexión. Las notas viven en IndexedDB (no pasan por acá).
// La página principal se pide siempre fresca para que las versiones nuevas lleguen enseguida.
const CACHE = 'apunte-v2';
const CORE = ['./', 'manifest.webmanifest?v=2', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  e.respondWith(
    fetch(isPage ? new Request(req, { cache: 'no-store' }) : req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(isPage ? './' : req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(isPage ? './' : req).then((r) => r || caches.match('./')))
  );
});

// Apunte: guarda la app en el teléfono para abrir al instante y sin conexión.
//  - La pantalla se sirve SIEMPRE desde lo guardado (no espera a internet, aunque la señal esté colgada).
//  - Si hay conexión, en segundo plano se baja la versión nueva completa (código y letras) y recién cuando
//    está entera reemplaza a la anterior, así nunca queda a medias. Se usa en el próximo arranque.
//  - Las notas no pasan por acá: viven en IndexedDB.
const APP = 'apunte-app-v3';
const INDEX = new URL('./', self.registration.scope).href;
const CORE = ['manifest.webmanifest?v=2', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map((u) => new URL(u, INDEX).href);

const timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

/** Direcciones de todo lo que necesita la página: lo que nombra index.html, los chunks de JS y lo que pide el CSS (letras). */
async function discover(html) {
  const urls = new Set(CORE);
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const u = new URL(m[1], INDEX);
    if (u.origin === self.location.origin && /\/assets\//.test(u.pathname)) urls.add(u.href);
  }
  for (const u of [...urls]) {
    if (!/\.(css|js)$/.test(u) || !/\/assets\//.test(u)) continue;
    const text = await (await fetch(u, { signal: timeout(20000) })).text();
    const re = u.endsWith('.css') ? /url\(\s*["']?([^"')]+)["']?\s*\)/g : /["'](\.\/[\w.-]+\.(?:js|css|woff2))["']/g;
    for (const m of text.matchAll(re)) { if (!m[1].startsWith('data:')) urls.add(new URL(m[1], u).href); }
  }
  return urls;
}

async function updateShell(force) {
  const cache = await caches.open(APP);
  const res = await fetch(INDEX, { cache: 'no-store', signal: timeout(15000) });
  if (!res.ok) return false;
  const html = await res.clone().text();
  const old = await cache.match(INDEX);
  if (old && !force && (await old.text()) === html) return false; // ya está la última
  const urls = await discover(html);
  await Promise.all([...urls].map(async (u) => {
    if (await cache.match(u)) return;
    const r = await fetch(u, { cache: 'reload', signal: timeout(30000) });
    if (!r.ok) throw new Error('No se pudo bajar ' + u);
    await cache.put(u, r);
  }));
  await cache.put(INDEX, res); // recién ahora, con todo lo demás ya guardado
  for (const req of await cache.keys()) if (/\/assets\//.test(req.url) && !urls.has(req.url)) await cache.delete(req); // limpia versiones viejas
  return true;
}

self.addEventListener('install', (e) => {
  e.waitUntil(updateShell(true).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== APP).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});

async function shell(e) {
  const cache = await caches.open(APP);
  const hit = await cache.match(INDEX, { ignoreSearch: true });
  if (hit) { e.waitUntil(updateShell(false).catch(() => {})); return hit; }
  try { return await fetch(e.request); } catch { return Response.error(); }
}

async function cacheFirst(req) {
  const cache = await caches.open(APP);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req, { signal: timeout(20000) });
    if (r.ok) cache.put(req, r.clone());
    return r;
  } catch { return Response.error(); }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.cache === 'no-store' || req.cache === 'reload') return; // las comprobaciones de versión van siempre a la red
  e.respondWith(req.mode === 'navigate' ? shell(e) : cacheFirst(req));
});

// La app pide bajar la versión nueva completa antes de recargarse.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'update-shell') {
    e.waitUntil(updateShell(false).then((changed) => e.source && e.source.postMessage({ type: 'shell-ready', changed })).catch(() => e.source && e.source.postMessage({ type: 'shell-ready', changed: false })));
  }
});

// Replaced by the build plugin. This file is a classic worker in the published app.
const VERSION = '__VERSION__';
const FILES = ['__FILES__'];
const scope = self.registration.scope;
const prefix = `contour-workbench:${new URL(scope).pathname}:`;
const cacheName = prefix + VERSION;
const urls = FILES.map(file => new URL(file, scope).href);
const precached = new Set(urls);
const index = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  // A partial deployment must not replace a working, complete offline version.
  event.waitUntil(
    caches
      .open(cacheName)
      .then(cache => cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })))),
  );
});
self.addEventListener('activate', event => {
  // No skipWaiting: active projects keep their current app/worker version until closed.
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const path = url.origin + url.pathname;
  const navigation = event.request.mode === 'navigate' && (path === scope || path === index);
  const key = navigation ? index : event.request.url;
  // Only the shipped app shell is cached. Provider data and large presets stay network-only.
  if (!navigation && !precached.has(key)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(key)) || fetch(event.request);
    })(),
  );
});

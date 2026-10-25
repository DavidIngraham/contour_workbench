// Replaced by the build plugin. This file is a classic worker in the published app.
const VERSION = '__VERSION__';
const FILES = ['__FILES__'];
const scope = self.registration.scope;
const prefix = `contour-workbench:${new URL(scope).pathname}:`;
const cacheName = prefix + VERSION;
const urls = FILES.map(file => new URL(file, scope).href);
const precached = new Set(urls);
const index = new URL('index.html', scope).href;
let pendingUpdate;
let applyingUpdate = false;

// Keep version activation explicit. Every open window must finish and save before
// its old cache can be removed or its lazy assets replaced by a new release.
self.addEventListener('message', event => {
  const data = event.data;
  const source = event.source;
  if (!source?.id) return;
  if (data?.type === 'UPDATE_READY' || data?.type === 'UPDATE_BLOCKED') {
    if (pendingUpdate?.id !== data.requestId) return;
    const response = pendingUpdate.responses.get(source.id);
    if (!response) return;
    if (data.type === 'UPDATE_READY') response.resolve();
    else response.reject(new Error(String(data.reason || 'A project could not be saved.')));
    return;
  }
  if (data?.type !== 'APPLY_UPDATE' || applyingUpdate) return;
  applyingUpdate = true;
  event.waitUntil(
    (async () => {
      const windows = (
        await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      ).filter(client => client.url.startsWith(scope));
      if (!windows.some(client => client.id === source.id)) return;
      const request = { id: crypto.randomUUID(), responses: new Map() };
      pendingUpdate = request;
      let timer;
      try {
        const ready = windows.map(
          client =>
            new Promise((resolve, reject) => {
              request.responses.set(client.id, { resolve, reject });
              client.postMessage({ type: 'PREPARE_UPDATE', requestId: request.id });
            }),
        );
        await Promise.race([
          Promise.all(ready),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Another Workbench window did not respond. Close that window and try again.',
                  ),
                ),
              15000,
            );
          }),
        ]);
        await self.skipWaiting();
      } catch (error) {
        for (const client of windows)
          client.postMessage({
            type: 'UPDATE_CANCELED',
            requestId: request.id,
            reason: error.message,
          });
      } finally {
        clearTimeout(timer);
        pendingUpdate = undefined;
      }
    })().finally(() => {
      applyingUpdate = false;
    }),
  );
});

self.addEventListener('install', event => {
  // A partial deployment must not replace a working, complete offline version.
  event.waitUntil(
    caches
      .open(cacheName)
      .then(cache => cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })))),
  );
});
self.addEventListener('activate', event => {
  // Background installs wait for old windows to close. Explicit activation above
  // is permitted only after every open window has acknowledged a durable save.
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

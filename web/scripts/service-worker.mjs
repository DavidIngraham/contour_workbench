// Replaced by the build plugin. Project data is never stored in these caches.
const VERSION = '__VERSION__';
const COMPATIBILITY = '__COMPATIBILITY__';
const FILES = ['__FILES__'];
const scope = self.registration.scope;
const prefix = `contour-workbench:${new URL(scope).pathname}:`;
const cacheName = prefix + VERSION;
const clientCacheName = prefix + 'clients';
const releaseKey = new URL('__pwa_release__', scope).href;
const index = new URL('index.html', scope).href;
const activeKey = new URL('__pwa_active__', scope).href;
const urls = FILES.map(file => new URL(file.url, scope).href);
const precached = new Set(urls);

async function releases() {
  const names = (await caches.keys()).filter(
    name => name.startsWith(prefix) && name !== clientCacheName,
  );
  return Promise.all(
    names.map(async name => {
      const response = await caches.match(releaseKey, { cacheName: name });
      // Before independent updates, releases used the same version-1 project schema.
      const manifest = response
        ? await response.json()
        : { compatibility: 1, files: [], activated: true };
      return { name, manifest };
    }),
  );
}

async function activateCompatibleRelease() {
  const previous = (await releases()).filter(release => release.name !== cacheName);
  if (previous.every(release => String(release.manifest.compatibility) === COMPATIBILITY))
    await self.skipWaiting();
}

// Persist client leases because service workers can stop between any two events.
// Unknown/legacy and frozen clients retain their assets; they never block activation.
async function collectUnusedReleases() {
  const windows = (
    await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  ).filter(client => client.url.startsWith(scope));
  const controlled = new Set(
    (await self.clients.matchAll({ type: 'window' })).map(client => client.id),
  );
  if (windows.some(client => !controlled.has(client.id))) return;
  const clients = await caches.open(clientCacheName);
  const retained = new Set([VERSION]);
  for (const client of windows) {
    const response = await clients.match(new URL(`__pwa_client__/${client.id}`, scope).href);
    if (!response) return;
    const lease = await response.json();
    if (typeof lease.controllerVersion !== 'string') return;
    retained.add(lease.version);
    retained.add(lease.controllerVersion);
  }
  for (const release of await releases())
    if (release.manifest.activated && !retained.has(release.name.slice(prefix.length))) {
      const active = await clients.match(activeKey);
      if (!active || (await active.json()).version !== VERSION) return;
      await caches.delete(release.name);
    }
  const live = new Set(windows.map(client => new URL(`__pwa_client__/${client.id}`, scope).href));
  for (const request of await clients.keys())
    if (request.url.includes('/__pwa_client__/') && !live.has(request.url))
      await clients.delete(request);
}

self.addEventListener('message', event => {
  const source = event.source;
  if (!source?.id || !source.url.startsWith(scope)) return;
  if (event.data?.type === 'GET_RELEASE') {
    event.waitUntil(
      (async () => {
        const pageVersion = event.data.pageVersion;
        const manifest =
          typeof pageVersion === 'string'
            ? await caches.match(releaseKey, { cacheName: prefix + pageVersion })
            : undefined;
        const pageCached = manifest ? (await manifest.json()).activated === true : false;
        event.ports[0]?.postMessage({ version: VERSION, compatibility: COMPATIBILITY, pageCached });
      })(),
    );
  } else if (event.data?.type === 'ACTIVATE_COMPATIBLE') {
    // Reconcile a completed installation that remained waiting after a refresh
    // or overlapping update checks. Recheck compatibility inside the worker.
    event.waitUntil(activateCompatibleRelease());
  } else if (event.data?.type === 'APPLY_UPDATE') {
    // End the obsolete global protocol in already-loaded pages without forcing
    // a reload over an unsaved project in that older application.
    source.postMessage({
      type: 'UPDATE_CANCELED',
      reason: 'The new version is ready. Refresh this window once to enable automatic updates.',
    });
  } else if (event.data?.type === 'CLIENT_RELEASE' && typeof event.data.version === 'string') {
    event.waitUntil(
      (async () => {
        const clients = await caches.open(clientCacheName);
        await clients.put(
          new URL(`__pwa_client__/${source.id}`, scope).href,
          Response.json({ version: event.data.version, controllerVersion: VERSION }),
        );
        await collectUnusedReleases();
      })(),
    );
  }
});

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const previous = (await releases()).filter(release => release.name !== cacheName);
      const cache = await caches.open(cacheName);
      try {
        // Mark in-progress caches before downloading; an old worker can still
        // collect releases during this installation.
        await cache.put(
          releaseKey,
          Response.json({
            version: VERSION,
            compatibility: COMPATIBILITY,
            files: [],
            activated: false,
          }),
        );
        await Promise.all(
          FILES.map(async (file, i) => {
            const url = urls[i];
            let response;
            for (const release of previous) {
              const unchanged = release.manifest.files.some(
                old => old.url === file.url && old.revision === file.revision,
              );
              const legacyHashedAsset =
                !release.manifest.version && /-[\w-]{8}\.(?:js|css|wasm)$/.test(file.url);
              if (unchanged || legacyHashedAsset)
                response = await caches.match(url, { cacheName: release.name });
              if (response) break;
            }
            if (!response) {
              response = await fetch(new Request(url, { cache: 'reload' }));
              const digest = await crypto.subtle.digest(
                'SHA-256',
                await response.clone().arrayBuffer(),
              );
              const revision = [...new Uint8Array(digest)]
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
              if (revision !== file.revision)
                throw new Error(`Offline asset has the wrong revision: ${file.url}`);
            }
            if (!response.ok) throw new Error(`Offline asset unavailable: ${file.url}`);
            await cache.put(url, response);
          }),
        );
        await cache.put(
          releaseKey,
          Response.json({
            version: VERSION,
            compatibility: COMPATIBILITY,
            files: FILES,
          }),
        );
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
      await activateCompatibleRelease();
    })(),
  );
});

self.addEventListener('activate', event => {
  // Keep old caches until their windows identify themselves or close. A newly
  // claimed old page can still lazy-load its original workers, JS, and WASM.
  event.waitUntil(
    (async () => {
      const clients = await caches.open(clientCacheName);
      await clients.put(activeKey, Response.json({ version: VERSION }));
      const cache = await caches.open(cacheName);
      const response = await cache.match(releaseKey);
      const manifest = await response.json();
      await cache.put(releaseKey, Response.json({ ...manifest, activated: true }));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== new URL(scope).origin || !url.href.startsWith(scope)) return;
  const path = url.origin + url.pathname;
  const navigation = event.request.mode === 'navigate' && (path === scope || path === index);
  const key = navigation ? index : event.request.url;
  const oldAsset = url.pathname.startsWith(new URL('assets/', scope).pathname);
  if (!navigation && !precached.has(key) && !oldAsset) return;
  event.respondWith(
    (async () => {
      const current = await caches.match(key, { cacheName });
      if (current) return current;
      // A navigation may have been dispatched to a retired worker immediately
      // before claim/collection. Its complete successor remains safe offline.
      if (navigation) {
        const active = await caches.match(activeKey, { cacheName: clientCacheName });
        if (active) {
          const successor = await caches.match(key, {
            cacheName: prefix + (await active.json()).version,
          });
          if (successor) return successor;
        }
      }
      if (oldAsset)
        for (const release of await releases()) {
          const response = await caches.match(key, { cacheName: release.name });
          if (response) return response;
        }
      return fetch(event.request);
    })(),
  );
});

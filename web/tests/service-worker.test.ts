import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const scope = 'https://example.test/contour_workbench/';
const prefix = 'contour-workbench:/contour_workbench/:';

async function worker(version = 'test-2', compatibility = '1') {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | Request) => (typeof request === 'string' ? request : request.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name)!;
    return {
      match: async (request: string | Request) => entries.get(key(request))?.clone(),
      put: async (request: string | Request, response: Response) => {
        entries.set(key(request), response.clone());
      },
      keys: async () => [...entries.keys()].map(url => new Request(url)),
      delete: async (request: string | Request) => entries.delete(key(request)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | Request, options: { cacheName: string }) =>
      stores.get(options.cacheName)?.get(key(request))?.clone(),
  };
  const client = { id: 'editing', url: scope };
  const windows = [client];
  const controlled = [client];
  const listeners = new Map<string, (event: any) => void>();
  const fetch = vi.fn(async () => {
    throw new Error('Offline');
  });
  const skipWaiting = vi.fn(async () => {});
  const source = (await readFile(new URL('../scripts/service-worker.mjs', import.meta.url), 'utf8'))
    .replace('__VERSION__', version)
    .replace('__COMPATIBILITY__', compatibility)
    .replace("['__FILES__']", '[]');
  const api = runInNewContext(source + '\n({ collectUnusedReleases });', {
    self: {
      registration: { scope },
      skipWaiting,
      clients: {
        matchAll: async (options: { includeUncontrolled?: boolean }) =>
          options.includeUncontrolled ? windows : controlled,
      },
      addEventListener: (type: string, callback: (event: any) => void) =>
        listeners.set(type, callback),
    },
    caches,
    URL,
    Request,
    Response,
    fetch,
  });
  const putRelease = async (release: string, activated = true) => {
    const cache = await open(prefix + release);
    await cache.put(
      scope + '__pwa_release__',
      Response.json({ version: release, activated, compatibility: 1, files: [] }),
    );
    await cache.put(scope + 'index.html', new Response(release));
  };
  const leases = await open(prefix + 'clients');
  await leases.put(scope + '__pwa_active__', Response.json({ version }));
  const message = async (data: unknown) => {
    let pending: Promise<unknown> | undefined;
    let reply: any;
    listeners.get('message')!({
      data,
      source: client,
      ports: [
        {
          postMessage: (data: unknown) => {
            reply = data;
          },
        },
      ],
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });
    await pending;
    return reply;
  };
  return {
    stores,
    leases,
    controlled,
    putRelease,
    message,
    fetch,
    skipWaiting,
    listeners,
    collect: () => api.collectUnusedReleases(),
  };
}

it('explicitly activates a compatible completed update without permitting incompatible storage upgrades', async () => {
  const compatible = await worker();
  await compatible.putRelease('test-1');
  await compatible.message({ type: 'ACTIVATE_COMPATIBLE' });
  expect(compatible.skipWaiting).toHaveBeenCalledTimes(1);
  const incompatible = await worker('test-2', '2');
  await incompatible.putRelease('test-1');
  await incompatible.message({ type: 'ACTIVATE_COMPATIBLE' });
  expect(incompatible.skipWaiting).not.toHaveBeenCalled();
});

it('does not collect a release while an uncontrolled window is still being claimed', async () => {
  const w = await worker();
  await w.putRelease('test-1');
  await w.putRelease('test-2');
  await w.leases.put(
    scope + '__pwa_client__/editing',
    Response.json({ version: 'test-2', controllerVersion: 'test-2' }),
  );
  w.controlled.length = 0;
  await w.collect();
  expect(w.stores.has(prefix + 'test-1')).toBe(true);
  w.controlled.push({ id: 'editing', url: scope });
  await w.collect();
  expect(w.stores.has(prefix + 'test-1')).toBe(false);
});

it('keeps legacy leases conservative until the current controller acknowledges them', async () => {
  const w = await worker();
  await w.putRelease('test-1');
  await w.putRelease('test-2');
  await w.leases.put(scope + '__pwa_client__/editing', Response.json({ version: 'test-2' }));
  await w.collect();
  expect(w.stores.has(prefix + 'test-1')).toBe(true);
  await w.message({ type: 'CLIENT_RELEASE', version: 'test-2' });
  expect(w.stores.has(prefix + 'test-1')).toBe(false);
});

it('retains both HTML and controller releases until the handoff is acknowledged', async () => {
  const w = await worker();
  await w.putRelease('test-1');
  await w.putRelease('test-2');
  await w.leases.put(
    scope + '__pwa_client__/editing',
    Response.json({ version: 'test-2', controllerVersion: 'test-1' }),
  );
  await w.collect();
  expect(w.stores.has(prefix + 'test-1')).toBe(true);
  await w.message({ type: 'CLIENT_RELEASE', version: 'test-2' });
  expect(w.stores.has(prefix + 'test-1')).toBe(false);
});

it('records which controller accepted a newer network page lease', async () => {
  const w = await worker('test-1');
  await w.message({ type: 'CLIENT_RELEASE', version: 'test-2' });
  expect(await (await w.leases.match(scope + '__pwa_client__/editing'))!.json()).toEqual({
    version: 'test-2',
    controllerVersion: 'test-1',
  });
});

it('distinguishes an installed older page from newer HTML still waiting for its worker', async () => {
  const w = await worker();
  await w.putRelease('test-1');
  await w.putRelease('test-3', false);
  expect(await w.message({ type: 'GET_RELEASE', pageVersion: 'test-1' })).toMatchObject({
    version: 'test-2',
    pageCached: true,
  });
  expect(await w.message({ type: 'GET_RELEASE', pageVersion: 'test-3' })).toMatchObject({
    pageCached: false,
  });
  expect(await w.message({ type: 'GET_RELEASE', pageVersion: 'missing' })).toMatchObject({
    pageCached: false,
  });
});

it('serves the complete active successor offline when an in-flight retired navigation loses its cache', async () => {
  const w = await worker('test-1');
  await w.putRelease('test-2');
  await w.leases.put(scope + '__pwa_active__', Response.json({ version: 'test-2' }));
  let response: Promise<Response> | undefined;
  w.listeners.get('fetch')!({
    request: { method: 'GET', mode: 'navigate', url: scope },
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  expect(await (await response)!.text()).toBe('test-2');
  expect(w.fetch).not.toHaveBeenCalled();
});

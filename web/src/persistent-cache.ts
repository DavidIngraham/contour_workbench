/** Small IndexedDB-backed cache for expensive remote terrain and OSM responses. */
interface CacheEnvelope<T> {
  createdAt: number;
  value: T;
}

const databaseName = 'contour-workbench-cache';
const storeName = 'responses';
const memory = new Map<string, CacheEnvelope<unknown>>();
let database: Promise<IDBDatabase | undefined> | undefined;

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (database) return database;
  database = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined);
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
  return database;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise(resolve => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

/** Produce a compact deterministic key without retaining a complete Overpass query in IndexedDB. */
export function persistentCacheKey(namespace: string, input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${namespace}:${(hash >>> 0).toString(16).padStart(8, '0')}:${input.length}`;
}

/** Read a non-expired cache entry. Failures degrade to an in-memory cache miss. */
export async function readPersistentCache<T>(
  key: string,
  maximumAgeMs: number,
): Promise<T | undefined> {
  let envelope = memory.get(key) as CacheEnvelope<T> | undefined;
  if (!envelope) {
    const db = await openDatabase();
    if (db) {
      const transaction = db.transaction(storeName, 'readonly');
      envelope = await requestValue<CacheEnvelope<T>>(transaction.objectStore(storeName).get(key));
      if (envelope) memory.set(key, envelope);
    }
  }
  if (!envelope) return undefined;
  if (Date.now() - envelope.createdAt > maximumAgeMs) {
    memory.delete(key);
    return undefined;
  }
  return structuredClone(envelope.value);
}

/** Store a cache entry. Storage failures never prevent the requested user operation. */
export async function writePersistentCache<T>(key: string, value: T): Promise<void> {
  const envelope: CacheEnvelope<T> = { createdAt: Date.now(), value: structuredClone(value) };
  memory.set(key, envelope);
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>(resolve => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(envelope, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

/** Clear in-memory state for deterministic tests; persistent data expires by policy. */
export function clearMemoryCache() {
  memory.clear();
}

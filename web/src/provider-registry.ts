/** Provider selection and retry policy for remote elevation and OpenStreetMap data. */
import type { Bounds, Product } from './types';

/** Resolved URLs and canonical product name returned by an elevation catalog. */
export interface ElevationResolution {
  urls: string[];
  product: Exclude<Product, 'auto'>;
}

/** Context supplied to an elevation URL provider. */
export interface ElevationProviderContext {
  bounds: Bounds;
  product: Exclude<Product, 'auto'>;
  signal: AbortSignal;
  copernicusUrls: (ninety: boolean) => Promise<string[]>;
  fetchJson: (url: string, signal?: AbortSignal) => Promise<unknown>;
  selectUsgsTiles: (items: unknown[]) => string[];
}

/** A catalog that resolves one family of elevation products to GeoTIFF URLs. */
export interface ElevationUrlProvider {
  id: string;
  supports(product: Exclude<Product, 'auto'>): boolean;
  resolve(context: ElevationProviderContext): Promise<ElevationResolution>;
}

const usgsProvider: ElevationUrlProvider = {
  id: 'usgs',
  supports: product => product.startsWith('usgs'),
  async resolve({ bounds, product, signal, fetchJson, selectUsgsTiles }) {
    const dataset =
      product === 'usgs_3dep_30m'
        ? 'National Elevation Dataset (NED) 1 arc-second'
        : 'National Elevation Dataset (NED) 1/3 arc-second';
    let offset = 0;
    const items: unknown[] = [];
    do {
      const query = new URLSearchParams({
        bbox: bounds.join(','),
        datasets: dataset,
        outputFormat: 'JSON',
        max: '100',
        offset: String(offset),
      });
      const data = (await fetchJson(
        `https://tnmaccess.nationalmap.gov/api/v1/products?${query}`,
        signal,
      )) as { error?: unknown; items?: unknown[]; total?: number };
      if (data.error) throw new Error('USGS catalog query failed. Try again later.');
      items.push(...(data.items || []));
      offset += 100;
      if (offset >= (data.total || 0)) break;
      if (offset > 1000) throw new Error('Too many elevation assets. Select a smaller area.');
    } while (true);
    const urls = selectUsgsTiles(items);
    if (!urls.length)
      throw new Error(
        'No 3DEP rasters were found here. Select Copernicus GLO-30 and load the area to use the global source.',
      );
    return {
      urls,
      product: product === 'usgs_3dep_30m' ? product : 'usgs_3dep_10m',
    };
  },
};

const copernicusProvider: ElevationUrlProvider = {
  id: 'copernicus',
  supports: product => product.startsWith('copernicus'),
  async resolve({ product, copernicusUrls }) {
    return {
      urls: await copernicusUrls(product === 'copernicus_glo90'),
      product,
    };
  },
};

const elevationProviders = [usgsProvider, copernicusProvider];

/** Resolve a selected elevation product through the registered catalog provider. */
export async function resolveElevationUrls(
  context: ElevationProviderContext,
): Promise<ElevationResolution> {
  const provider = elevationProviders.find(candidate => candidate.supports(context.product));
  if (!provider) throw new Error(`No elevation provider supports ${context.product}.`);
  return provider.resolve(context);
}

/** Public global Overpass mirrors attempted in rotation when a service is unavailable. */
export const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const;

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Progress emitted for one bounded Overpass request or backoff. */
export interface OverpassProgress {
  attempt: number;
  maxAttempts: number;
  endpoint: string;
  phase: 'request' | 'backoff';
  message: string;
}

/** Injectable retry controls used by tests and specialized deployments. */
export interface OverpassRetryOptions {
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  onProgress?: (progress: OverpassProgress) => void;
}

class OverpassAttemptError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('OpenStreetMap request canceled.', 'AbortError');
}

function retryAfterMs(response: Response) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function timeoutRemark(remark: string) {
  return /(?:timed?\s*out|timeout)|runtime error[^\n]*(?:time|quota|memory)/i.test(remark);
}

function deduplicateElements(elements: unknown[]) {
  const seen = new Set<string>();
  return elements.filter(element => {
    if (!element || typeof element !== 'object') return true;
    const candidate = element as { type?: unknown; id?: unknown };
    if (typeof candidate.type !== 'string' || !['string', 'number'].includes(typeof candidate.id))
      return true;
    const key = candidate.type + ':' + String(candidate.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultSleep(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortReason(signal));
    const timer = setTimeout(done, delayMs);
    function done() {
      signal.removeEventListener('abort', canceled);
      resolve();
    }
    function canceled() {
      clearTimeout(timer);
      reject(abortReason(signal));
    }
    signal.addEventListener('abort', canceled, { once: true });
  });
}

/** Execute an Overpass query with per-attempt timeouts, mirror rotation, and a hard total cap. */
export async function queryOverpass(
  query: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  endpoints: readonly string[] = overpassEndpoints,
  options: OverpassRetryOptions = {},
): Promise<unknown> {
  if (!endpoints.length) throw new Error('No OpenStreetMap service endpoints are configured.');
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 25_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 75_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseBackoffMs = options.baseBackoffMs ?? 300;
  const maxBackoffMs = options.maxBackoffMs ?? 4_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const failures: string[] = [];
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) throw abortReason(signal);
    const elapsed = Date.now() - startedAt;
    if (elapsed >= totalTimeoutMs) break;
    const endpoint = endpoints[(attempt - 1) % endpoints.length];
    const host = new URL(endpoint).host;
    options.onProgress?.({
      attempt,
      maxAttempts,
      endpoint,
      phase: 'request',
      message: `OpenStreetMap attempt ${attempt} of ${maxAttempts} via ${host}…`,
    });

    const attemptController = new AbortController();
    let timedOut = false;
    let requestedRetryAfterMs = 0;
    const parentCanceled = () => attemptController.abort(abortReason(signal));
    signal.addEventListener('abort', parentCanceled, { once: true });
    const remainingMs = totalTimeoutMs - elapsed;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        attemptController.abort(
          new DOMException('OpenStreetMap attempt timed out.', 'TimeoutError'),
        );
      },
      Math.max(1, Math.min(attemptTimeoutMs, remainingMs)),
    );

    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: attemptController.signal,
      });
      if (!response.ok) {
        const retryable = transientStatuses.has(response.status);
        throw new OverpassAttemptError(
          `OpenStreetMap request was rejected (${response.status}).`,
          retryable,
          retryAfterMs(response),
        );
      }
      const text = await response.text();
      let data: { remark?: string; elements?: unknown[] };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw new OverpassAttemptError(
          timeoutRemark(text)
            ? 'OpenStreetMap reported a runtime timeout.'
            : 'OpenStreetMap returned an invalid response.',
          timeoutRemark(text),
        );
      }
      if (data.remark) {
        if (!timeoutRemark(data.remark))
          throw new OverpassAttemptError(`OpenStreetMap rejected the query: ${data.remark}`, false);
        throw new OverpassAttemptError('OpenStreetMap reported a runtime timeout.', true);
      }
      if (!Array.isArray(data.elements))
        throw new OverpassAttemptError('OpenStreetMap returned an invalid response.', false);
      return { ...data, elements: deduplicateElements(data.elements) };
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      if (timedOut) failures.push(`${host}: timed out`);
      else if (error instanceof OverpassAttemptError) {
        if (!error.retryable) throw error;
        failures.push(`${host}: ${error.message}`);
        requestedRetryAfterMs = error.retryAfterMs;
      } else {
        failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', parentCanceled);
    }

    if (attempt >= maxAttempts) break;
    const remainingAfterAttempt = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingAfterAttempt <= 0) break;
    const exponential = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
    const jittered = exponential * (0.75 + random() * 0.5);
    const delayMs = Math.min(
      remainingAfterAttempt,
      maxBackoffMs,
      Math.max(jittered, requestedRetryAfterMs),
    );
    options.onProgress?.({
      attempt,
      maxAttempts,
      endpoint,
      phase: 'backoff',
      message: `OpenStreetMap service is busy; retrying in ${Math.max(1, Math.ceil(delayMs / 1000))} s…`,
    });
    await sleep(delayMs, signal);
  }

  throw new Error(
    `OpenStreetMap did not respond after ${failures.length} attempts. Terrain is ready; use Retry trails and water. (${failures.join('; ')})`,
  );
}

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

/** Public Overpass mirrors attempted in order when a service is unavailable. */
export const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Execute an Overpass query with bounded failover for network and transient service errors. */
export async function queryOverpass(
  query: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  endpoints: readonly string[] = overpassEndpoints,
): Promise<unknown> {
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
      });
      if (!response.ok) {
        if (!retryableStatus(response.status))
          throw new Error(`OpenStreetMap request was rejected (${response.status}).`);
        failures.push(`${new URL(endpoint).host}: ${response.status}`);
        continue;
      }
      const data = (await response.json()) as { remark?: string; elements?: unknown[] };
      if (data.remark) {
        failures.push(`${new URL(endpoint).host}: incomplete response`);
        continue;
      }
      if (!Array.isArray(data.elements)) throw new Error('Invalid OSM response');
      return data;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof Error && /rejected|Invalid OSM/.test(error.message)) throw error;
      failures.push(
        `${new URL(endpoint).host}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `OpenStreetMap services are busy. Try again later; your features are unchanged. (${failures.join('; ')})`,
  );
}

/** Browser data adapters for USGS, Copernicus downloads, GeoTIFF imports, and Overpass. */
import { automaticProduct, sourceSampleCount } from './source-resolution';
import { selectUsgsTiles } from './usgs-catalog';
import { persistentCacheKey, readPersistentCache, writePersistentCache } from './persistent-cache';
import { queryOverpass, resolveElevationUrls, type OverpassProgress } from './provider-registry';
import type { Bounds, Grid, Product, Source } from './types';

type GeoTiffModule = typeof import('geotiff');
type GeoTiff = Awaited<ReturnType<GeoTiffModule['fromUrl']>>;
const elevationCacheAgeMs = 30 * 24 * 60 * 60 * 1000;
const osmCacheAgeMs = 24 * 60 * 60 * 1000;
/** Fetch JSON and translate service failures into user-facing errors. */
export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(
      `Data service returned ${response.status}. Try again later; the current model is unchanged.`,
    );
  return response.json();
}
/** Validate geographic bounds supported by browser raster processing. */
export function checkBounds(b: Bounds) {
  if (
    b.some(x => !Number.isFinite(x)) ||
    b[0] >= b[2] ||
    b[1] >= b[3] ||
    b[0] < -180 ||
    b[2] > 180 ||
    b[1] < -85 ||
    b[3] > 85 ||
    b[2] - b[0] > 2 ||
    b[3] - b[1] > 2
  )
    throw new Error(
      'Enter west < east and south < north, within ±85° latitude. Use an area under 2° per side.',
    );
}
interface WindowRaster {
  values: ArrayLike<number>;
  width: number;
  height: number;
  origin: [number, number];
  step: [number, number];
  nodata: number | null;
  url: string;
}
async function raster(
  tiff: GeoTiff,
  b: Bounds,
  url: string,
  signal?: AbortSignal,
): Promise<WindowRaster | null> {
  const image = await tiff.getImage();
  const keys = image.getGeoKeys();
  const crs = keys.GeographicTypeGeoKey;
  if (keys.ProjectedCSTypeGeoKey || ![4326, 4269].includes(crs))
    throw new Error(
      `Unsupported raster CRS (${keys.ProjectedCSTypeGeoKey || crs}). Use a geographic WGS84/NAD83 DEM.`,
    );
  const origin = image.getOrigin();
  const step = image.getResolution();
  if (step[0] <= 0 || step[1] >= 0) throw new Error('Unsupported raster axis orientation');
  const point = keys.GTRasterTypeGeoKey === 2;
  const x0 = origin[0] + (point ? 0 : step[0] / 2);
  const y0 = origin[1] + (point ? 0 : step[1] / 2);
  const left = Math.max(0, Math.floor((b[0] - x0) / step[0]) - 1),
    right = Math.min(image.getWidth(), Math.ceil((b[2] - x0) / step[0]) + 2);
  const top = Math.max(0, Math.floor((b[3] - y0) / step[1]) - 1),
    bottom = Math.min(image.getHeight(), Math.ceil((b[1] - y0) / step[1]) + 2);
  if (right <= left || bottom <= top) return null;
  const data = await image.readRasters({
    window: [left, top, right, bottom],
    samples: [0],
    interleave: true,
    signal,
  });
  return {
    values: data as unknown as ArrayLike<number>,
    width: right - left,
    height: bottom - top,
    origin: [x0 + left * step[0], y0 + top * step[1]],
    step: [step[0], step[1]],
    nodata: image.getGDALNoData(),
    url,
  };
}
function mosaic(windows: WindowRaster[], bounds: Bounds): Grid {
  if (!windows.length)
    throw new Error('No elevation tiles cover this area. Choose a different source.');
  const dx = Math.min(...windows.map(r => r.step[0])),
    dy = Math.min(...windows.map(r => -r.step[1]));
  const anchor = windows[0].origin;
  bounds = [
    anchor[0] + Math.floor((bounds[0] - anchor[0]) / dx) * dx,
    anchor[1] + Math.floor((bounds[1] - anchor[1]) / dy) * dy,
    anchor[0] + Math.ceil((bounds[2] - anchor[0]) / dx) * dx,
    anchor[1] + Math.ceil((bounds[3] - anchor[1]) / dy) * dy,
  ];
  const width = Math.round((bounds[2] - bounds[0]) / dx) + 1,
    height = Math.round((bounds[3] - bounds[1]) / dy) + 1;
  if (width < 2 || height < 2)
    throw new Error('Choose an area covering at least two source samples per side.');
  if (width * height > 2_000_000)
    throw new Error(
      'This area exceeds the 2 million sample browser limit. Choose a smaller area or a coarser source.',
    );
  const elevations = new Array<number>(width * height);
  let missing = 0;
  for (let j = 0; j < height; j++) {
    const lat = bounds[1] + (j / (height - 1)) * (bounds[3] - bounds[1]);
    for (let i = 0; i < width; i++) {
      const lon = bounds[0] + (i / (width - 1)) * (bounds[2] - bounds[0]);
      let value: number | undefined;
      for (const r of windows) {
        const x = (lon - r.origin[0]) / r.step[0],
          y = (lat - r.origin[1]) / r.step[1];
        if (x < 0 || y < 0 || x > r.width - 1 || y > r.height - 1) continue;
        const a = Math.min(r.width - 2, Math.floor(x)),
          b = Math.min(r.height - 2, Math.floor(y));
        const samples = [
          r.values[b * r.width + a],
          r.values[b * r.width + a + 1],
          r.values[(b + 1) * r.width + a],
          r.values[(b + 1) * r.width + a + 1],
        ];
        if (samples.some(v => !Number.isFinite(v) || v === r.nodata || v < -12000)) continue;
        const u = x - a,
          v = y - b;
        value =
          samples[0] * (1 - u) * (1 - v) +
          samples[1] * u * (1 - v) +
          samples[2] * (1 - u) * v +
          samples[3] * u * v;
        break;
      }
      if (value === undefined) {
        missing++;
        value = 0;
      }
      elevations[j * width + i] = value;
    }
  }
  if (missing)
    throw new Error(
      `The selected source has ${missing.toLocaleString()} uncovered samples here. Try Copernicus or reduce the area; sources will not be mixed.`,
    );
  return { bounds, width, height, elevations };
}
/** Load, crop, and mosaic the selected remote elevation product. */
export async function loadElevation(
  bounds: Bounds,
  product: Product,
  copernicusUrls: (ninety: boolean) => Promise<string[]>,
  progress: (s: string) => void,
  signal: AbortSignal,
): Promise<{ grid: Grid; source: Source }> {
  checkBounds(bounds);
  if (product === 'auto') {
    product = automaticProduct(bounds);
    progress(
      `Selecting ${product.endsWith('10m') ? '10' : product.endsWith('90') ? '90' : '30'} m elevation for this area…`,
    );
  }
  const spacing = product.endsWith('10m') ? 10 : product.endsWith('90') ? 90 : 30;
  if (sourceSampleCount(bounds, spacing) > 2_000_000)
    throw new Error(
      'This area exceeds the 2 million sample browser limit at the selected resolution. Choose a coarser source or a smaller area.',
    );
  const requestedProduct = product as Exclude<Product, 'auto'>;
  const cacheKey = persistentCacheKey(
    'elevation-v1',
    JSON.stringify([requestedProduct, bounds.map(value => Number(value.toFixed(7)))]),
  );
  const cached = await readPersistentCache<{ grid: Grid; source: Source }>(
    cacheKey,
    elevationCacheAgeMs,
  );
  if (cached) {
    progress(`Using cached ${cached.source.name} elevation…`);
    return cached;
  }
  if (requestedProduct.startsWith('usgs')) progress('Finding USGS elevation coverage…');
  const { urls, product: resolved } = await resolveElevationUrls({
    bounds,
    product: requestedProduct,
    signal,
    copernicusUrls,
    fetchJson,
    selectUsgsTiles: items => selectUsgsTiles(items as Parameters<typeof selectUsgsTiles>[0]),
  });
  if (urls.length > 16)
    throw new Error('More than 16 raster assets are needed. Choose a smaller area.');
  const { fromUrl } = await import('geotiff');
  const windows: WindowRaster[] = [];
  for (let i = 0; i < urls.length; i++) {
    progress(`Reading elevation tile ${i + 1} of ${urls.length}…`);
    const tiff = await fromUrl(urls[i], { allowFullFile: false }, signal);
    const r = await raster(tiff, bounds, urls[i], signal);
    if (r) windows.push(r);
  }
  progress('Checking coverage and preparing terrain…');
  const grid = mosaic(windows, bounds);
  const source: Source = {
    product: resolved,
    name: resolved.startsWith('usgs')
      ? `USGS 3DEP · ${resolved.endsWith('10m') ? '10' : '30'} m`
      : `Copernicus · ${resolved.endsWith('30') ? '30' : '90'} m`,
    retrieved: new Date().toISOString(),
    attribution: resolved.startsWith('usgs')
      ? 'USGS 3D Elevation Program'
      : 'Copernicus DEM: © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.',
    urls,
  };
  const result = { grid, source };
  await writePersistentCache(cacheKey, result);
  return result;
}
/** Decode an uploaded geographic GeoTIFF over the requested bounds. */
export async function loadLocalRaster(buffer: ArrayBuffer, bounds: Bounds) {
  const { fromArrayBuffer } = await import('geotiff');
  const tiff = await fromArrayBuffer(buffer);
  const r = await raster(tiff, bounds, 'uploaded GeoTIFF');
  if (!r) throw new Error('GeoTIFF does not intersect the selected area');
  return {
    grid: mosaic([r], bounds),
    source: {
      product: 'uploaded',
      name: 'Uploaded elevation',
      retrieved: new Date().toISOString(),
      attribution: 'User-provided GeoTIFF',
    } as Source,
  };
}
/* Run an Overpass query with persistent caching and mirror failover. */
export async function loadOsm(
  query: string,
  signal: AbortSignal,
  onProgress?: (progress: OverpassProgress) => void,
) {
  const key = persistentCacheKey('overpass-v1', query);
  const cached = await readPersistentCache<unknown>(key, osmCacheAgeMs);
  if (cached) return cached;
  const data = await queryOverpass(query, signal, fetch, undefined, { onProgress });
  if (!signal.aborted) await writePersistentCache(key, data);
  return data;
}

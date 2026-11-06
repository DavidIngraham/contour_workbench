import type { Bounds } from './types';

/** Search result in the application's longitude/latitude convention. */
export interface LocationResult {
  name: string;
  center: [number, number];
  bounds: Bounds;
}

/** Accept explicit latitude, longitude input without contacting a provider. */
export function coordinateLocation(query: string): LocationResult | undefined {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return;
  const lat = Number(match[1]),
    lon = Number(match[2]);
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180)
    throw new Error('Enter latitude between −85 and 85 and longitude between −180 and 180.');
  return {
    name: `${lat}°, ${lon}°`,
    center: [lon, lat],
    bounds: [
      Math.max(-180, lon - 0.02),
      Math.max(-85, lat - 0.02),
      Math.min(180, lon + 0.02),
      Math.min(85, lat + 0.02),
    ],
  };
}

/** Validate provider data before it can move the map or create a boundary. */
export function parseLocations(value: unknown): LocationResult[] {
  if (!Array.isArray(value)) throw new Error('The location service returned an invalid response.');
  return value.slice(0, 5).flatMap(item => {
    if (
      !item ||
      typeof item.display_name !== 'string' ||
      !Array.isArray(item.boundingbox) ||
      item.boundingbox.length !== 4
    )
      return [];
    const numbers = [item.lat, item.lon, ...item.boundingbox];
    if (
      numbers.some(
        value =>
          (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '',
      )
    )
      return [];
    const lat = Number(item.lat),
      lon = Number(item.lon);
    const [south, north, west, east] = item.boundingbox.map(Number);
    if (
      ![lat, lon, south, north, west, east].every(Number.isFinite) ||
      Math.abs(lat) > 85 ||
      Math.abs(lon) > 180 ||
      south >= north ||
      west >= east ||
      south < -90 ||
      north > 90 ||
      west < -180 ||
      east > 180
    )
      return [];
    return [
      {
        name: item.display_name,
        center: [lon, lat] as [number, number],
        bounds: [west, south, east, north] as Bounds,
      },
    ];
  });
}

/** Submitted searches only: cached in memory, cancellable, and rate limited per page. */
export class LocationSearch {
  private cache = new Map<string, LocationResult[]>();
  private nextRequest = 0;
  async search(query: string, signal: AbortSignal): Promise<LocationResult[]> {
    const text = query.trim();
    const coordinates = coordinateLocation(text);
    if (coordinates) return [coordinates];
    if (text.length < 2) throw new Error('Enter a place name or latitude, longitude.');
    const key = text.toLocaleLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (Date.now() < this.nextRequest)
      throw new Error('Please wait a moment before searching again.');
    this.nextRequest = Date.now() + 1100;
    const endpoint =
      import.meta.env.VITE_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
    const url = new URL(endpoint, window.location.href);
    for (const [key, value] of Object.entries({ q: text, format: 'jsonv2', limit: '5' }))
      url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        'Location search is unavailable. Check your connection, try again, or enter coordinates.',
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'Location search is busy. Try again shortly, or enter coordinates.'
          : 'Location search is unavailable. Try again or enter coordinates.',
      );
    const results = parseLocations(await response.json());
    if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, results);
    return results;
  }
}

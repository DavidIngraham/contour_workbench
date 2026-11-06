import { afterEach, describe, expect, it, vi } from 'vitest';
import { coordinateLocation, LocationSearch, parseLocations } from '../src/location-search';

const response = [
  {
    display_name: 'Mount Hood, Oregon',
    lat: '45.37',
    lon: '-121.69',
    boundingbox: ['45.3', '45.4', '-121.8', '-121.6'],
  },
];
afterEach(() => vi.unstubAllGlobals());
describe('location search', () => {
  it('converts explicit latitude, longitude to longitude-first model coordinates', () => {
    expect(coordinateLocation('45.37, -121.69')?.center).toEqual([-121.69, 45.37]);
    expect(coordinateLocation('Mount Hood')).toBeUndefined();
    expect(() => coordinateLocation('91, -121')).toThrow(/latitude/);
  });
  it('validates provider bounds and ignores malformed locations', () => {
    expect(parseLocations(response)[0].bounds).toEqual([-121.8, 45.3, -121.6, 45.4]);
    expect(
      parseLocations([
        null,
        { ...response[0], lon: 'NaN' },
        { ...response[0], lat: null },
        { ...response[0], lon: '' },
        { ...response[0], boundingbox: ['0', '1', '2', '3', '4'] },
        { ...response[0], boundingbox: ['0', '1', '20', '10'] },
      ]),
    ).toEqual([]);
    expect(() => parseLocations({})).toThrow(/invalid/);
  });
  it('caches submitted searches, rate limits new queries, and leaves coordinates offline', async () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal('fetch', fetcher);
    const search = new LocationSearch(),
      controller = new AbortController();
    expect(await search.search('Mount Hood', controller.signal)).toHaveLength(1);
    await search.search('mount hood', controller.signal);
    await expect(search.search('Seattle', controller.signal)).rejects.toThrow(/wait/);
    await search.search('45, -121', controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it('offers recovery for network errors while preserving cancellation', async () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
    const failure = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await expect(new LocationSearch().search('Hood', new AbortController().signal)).rejects.toThrow(
      /Check your connection/,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(new LocationSearch().search('Hood', controller.signal)).rejects.toBe(failure);
  });
  it('exposes provider throttling as a retryable error', async () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(new LocationSearch().search('Hood', new AbortController().signal)).rejects.toThrow(
      /busy/,
    );
  });
});

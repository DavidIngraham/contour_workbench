import { describe, expect, it, vi } from 'vitest';
import { queryOverpass, resolveElevationUrls } from '../src/provider-registry';

describe('provider registry', () => {
  it('fails over to the next Overpass mirror after a transient response', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ type: 'node', id: 1 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const result = await queryOverpass(
      '[out:json];node(0,0,1,1);out;',
      new AbortController().signal,
      fetcher,
      ['https://one.example/api', 'https://two.example/api'],
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ elements: [{ type: 'node', id: 1 }] });
  });

  it('does not hide a permanent Overpass request rejection behind mirror retries', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    await expect(
      queryOverpass('bad', new AbortController().signal, fetcher, [
        'https://one.example/api',
        'https://two.example/api',
      ]),
    ).rejects.toThrow('rejected (400)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('selects the Copernicus provider without querying the USGS catalog', async () => {
    const fetchJson = vi.fn();
    const result = await resolveElevationUrls({
      bounds: [0, 0, 1, 1],
      product: 'copernicus_glo90',
      signal: new AbortController().signal,
      copernicusUrls: async ninety => (ninety ? ['glo90.tif'] : ['glo30.tif']),
      fetchJson,
      selectUsgsTiles: () => [],
    });
    expect(result).toEqual({ urls: ['glo90.tif'], product: 'copernicus_glo90' });
    expect(fetchJson).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { queryOverpass, resolveElevationUrls } from '../src/provider-registry';

const success = (elements: unknown[] = [{ type: 'node', id: 1 }]) =>
  new Response(JSON.stringify({ elements }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const fastRetries = {
  baseBackoffMs: 0,
  sleep: async () => {},
};

describe('provider registry', () => {
  it('rotates to another Overpass mirror after a 504 and deduplicates elements', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 504 }))
      .mockResolvedValueOnce(
        success([
          { type: 'node', id: 1 },
          { type: 'node', id: 1 },
          { type: 'way', id: 1 },
        ]),
      );
    const progress: string[] = [];
    const result = await queryOverpass(
      '[out:json];node(0,0,1,1);out;',
      new AbortController().signal,
      fetcher,
      ['https://one.example/api', 'https://two.example/api'],
      { ...fastRetries, maxAttempts: 2, onProgress: item => progress.push(item.message) },
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://one.example/api',
      'https://two.example/api',
    ]);
    expect(result).toEqual({
      elements: [
        { type: 'node', id: 1 },
        { type: 'way', id: 1 },
      ],
    });
    expect(progress).toContain('Loading trails and water… Attempt 2 of 2');
  });

  it('aborts a timed-out attempt before trying the next mirror', async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      )
      .mockResolvedValueOnce(success());
    const result = await queryOverpass(
      'query',
      new AbortController().signal,
      fetcher,
      ['https://slow.example/api', 'https://healthy.example/api'],
      { ...fastRetries, attemptTimeoutMs: 5, totalTimeoutMs: 100, maxAttempts: 2 },
    );
    expect(result).toEqual({ elements: [{ type: 'node', id: 1 }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries an Overpass runtime-timeout remark', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ remark: 'runtime error: Query timed out' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(success([{ type: 'way', id: 2 }]));
    const result = await queryOverpass(
      'query',
      new AbortController().signal,
      fetcher,
      ['https://one.example/api', 'https://two.example/api'],
      { ...fastRetries, maxAttempts: 2 },
    );
    expect(result).toEqual({ elements: [{ type: 'way', id: 2 }] });
  });

  it('honors Retry-After within the bounded backoff', async () => {
    const sleep = vi.fn(async () => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(success());
    await queryOverpass(
      'query',
      new AbortController().signal,
      fetcher,
      ['https://one.example/api', 'https://two.example/api'],
      { baseBackoffMs: 100, maxBackoffMs: 5_000, random: () => 0.5, sleep, maxAttempts: 2 },
    );
    expect(sleep).toHaveBeenCalledWith(2_000, expect.any(AbortSignal));
  });

  it('settles after the hard attempt cap when every mirror fails', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      queryOverpass(
        'query',
        new AbortController().signal,
        fetcher,
        ['https://one.example/api', 'https://two.example/api'],
        { ...fastRetries, maxAttempts: 3 },
      ),
    ).rejects.toThrow('did not respond after 3 attempts');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not hide a permanent Overpass request rejection behind mirror retries', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    await expect(
      queryOverpass(
        'bad',
        new AbortController().signal,
        fetcher,
        ['https://one.example/api', 'https://two.example/api'],
        fastRetries,
      ),
    ).rejects.toThrow('rejected (400)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops retries immediately when the caller cancels', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const request = queryOverpass(
      'query',
      controller.signal,
      fetcher,
      ['https://one.example/api', 'https://two.example/api'],
      { ...fastRetries, maxAttempts: 2 },
    );
    await Promise.resolve();
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
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

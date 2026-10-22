import { describe, expect, it, vi } from 'vitest';
import {
  customFeatureSource,
  defaultFeatureSources,
  downloadFeatureSource,
  identifySourceFeatures,
  mergeSourceFeatures,
  readFeatureSources,
  saveFeatureSources,
} from '../src/feature-sources';
import type { Bounds, Feature } from '../src/types';

const bounds: Bounds = [-121.65, 45.65, -121.59, 45.7];
const source = customFeatureSource(
  'Local trails',
  'https://example.org/trails?bbox={bbox}',
  'trail',
  'LABEL',
  'custom:test',
);
const raw = (id: number) => ({
  type: 'Feature',
  id,
  properties: { OBJECTID: id, LABEL: `Trail ${id}` },
  geometry: {
    type: 'LineString',
    coordinates: [
      [-121.63, 45.66],
      [-121.61, 45.68],
    ],
  },
});
const collection = (features: unknown[]) => ({ type: 'FeatureCollection', features });
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const fetchData = (data: unknown) =>
  vi.fn<typeof fetch>().mockImplementation(async () => json(data));
const signal = () => new AbortController().signal;
const normalized = (id = 'upload:0'): Feature => ({
  id,
  name: 'Trail',
  class: 'trail',
  enabled: true,
  treatment: 'insert',
  lines: [
    [
      [-121.63, 45.66],
      [-121.61, 45.68],
    ],
  ],
  tags: { OBJECTID: 1 },
});

describe('source library', () => {
  it('keeps curated entries separate and persists editable custom sources', () => {
    expect(defaultFeatureSources.map(s => s.id)).toEqual([
      'overpass',
      'hrc',
      'usfs',
      'nps',
      'blm',
      'wa-rco',
      'openskimap',
    ]);
    let value = '';
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    saveFeatureSources(storage, [source]);
    expect(readFeatureSources(storage)).toEqual([source]);
    value = JSON.stringify([{ ...source, id: 'hrc' }, null, source]);
    expect(readFeatureSources(storage)).toEqual([source]);
    value = 'broken json';
    expect(readFeatureSources(storage)).toEqual([]);
    expect(() =>
      saveFeatureSources(
        {
          setItem() {
            throw new Error('Quota');
          },
        },
        [source],
      ),
    ).toThrow('could not save');
  });
  it('recognizes ArcGIS layers and rejects unsupported URLs and placeholders', () => {
    expect(
      customFeatureSource('County', defaultFeatureSources[1].url + '/query?f=geojson', 'auto').kind,
    ).toBe('arcgis');
    for (const url of [
      'javascript:alert(1)',
      'http://example.org/trails',
      'https://user:password@example.org',
      'https://example.org/{unknown}',
    ])
      expect(() => customFeatureSource('Bad', url, 'auto')).toThrow();
  });
});

describe('source downloads', () => {
  it('requests OpenSkiMap runs and lifts by terrain area and preserves upstream identities', async () => {
    const ski = defaultFeatureSources.find(s => s.id === 'openskimap')!;
    const feature = {
      ...raw(1),
      id: undefined,
      properties: {
        id: 'content-v1',
        type: 'run',
        sources: [{ type: 'openstreetmap', id: 'way/42' }],
        name: 'Ridge',
        uses: ['downhill'],
        status: 'operating',
      },
    };
    const fetcher = fetchData(collection([feature]));
    const first = await downloadFeatureSource(ski, bounds, signal(), fetcher);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe('https://api.openskimap.org');
    expect(url.searchParams.get('bbox')).toBe(bounds.join(','));
    expect(url.searchParams.get('types')).toBe('run,lift');
    const updated = { ...feature, properties: { ...feature.properties, id: 'content-v2' } };
    const second = await downloadFeatureSource(
      ski,
      bounds,
      signal(),
      fetchData(collection([updated])),
    );
    expect(second.ids).toEqual(first.ids);
    const incoming = identifySourceFeatures(ski, first, [normalized()]);
    expect(incoming[0].tags.contour_source).toMatchObject({ attribution: ski.attribution });
    const split = await downloadFeatureSource(
      ski,
      bounds,
      signal(),
      fetchData(collection([feature, updated])),
    );
    expect(new Set(split.ids).size).toBe(2);
  });
  it('rejects OpenSkiMap requests larger than its area limit before downloading', async () => {
    const fetcher = fetchData(collection([]));
    const ski = defaultFeatureSources.find(s => s.id === 'openskimap')!;
    await expect(
      downloadFeatureSource(ski, [-122, 45, -121, 46], signal(), fetcher),
    ).rejects.toThrow('1,000 km²');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('expands bounds, selects intersecting geometries, and carries explicit import mapping', async () => {
    const outside = raw(2);
    outside.geometry.coordinates = [
      [0, 0],
      [1, 1],
    ];
    const fetcher = fetchData(collection([raw(1), outside]));
    const download = await downloadFeatureSource(source, bounds, signal(), fetcher);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('bbox')).toBe(
      bounds.join(','),
    );
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('omit');
    expect(download.geojson.features).toHaveLength(1);
    expect(download.geojson.feature_class).toBe('trail');
    expect(download.geojson.name_field).toBe('LABEL');
    expect(download.ids).toEqual(['1']);
  });
  it('uses stable identifiers for anonymous features even when response/property order changes', async () => {
    const a = { ...raw(1), id: undefined, properties: { name: 'A', highway: 'path' } };
    const b = { ...raw(2), id: undefined, properties: { name: 'B' } };
    const first = await downloadFeatureSource(
      source,
      bounds,
      signal(),
      fetchData(collection([a, b])),
    );
    const second = await downloadFeatureSource(
      source,
      bounds,
      signal(),
      fetchData(collection([b, { ...a, properties: { highway: 'path', name: 'A' } }])),
    );
    expect(first.ids).toEqual(second.ids.reverse());
  });
  it('fetches every ArcGIS ID batch in WGS84 and verifies completeness', async () => {
    const requests: URL[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.searchParams.get('returnIdsOnly') === 'true')
        return json({
          objectIdFieldName: 'OBJECTID',
          objectIds: Array.from({ length: 201 }, (_, i) => i + 1),
        });
      return json(
        collection(
          url.searchParams
            .get('objectIds')!
            .split(',')
            .map(id => raw(Number(id))),
        ),
      );
    });
    const result = await downloadFeatureSource(defaultFeatureSources[1], bounds, signal(), fetcher);
    expect(result.ids).toHaveLength(201);
    expect(requests).toHaveLength(3);
    expect(requests[0].searchParams.get('geometry')).toBe(bounds.join(','));
    expect(requests[1].searchParams.get('outSR')).toBe('4326');
    expect(requests[2].searchParams.get('objectIds')).toBe('201');
  });
  it.each(['usfs', 'nps', 'blm', 'wa-rco'])(
    'queries only the terrain area and maps the %s trail names',
    async id => {
      const curated = defaultFeatureSources.find(source => source.id === id)!;
      const idField = id === 'usfs' ? 'objectid' : 'OBJECTID';
      const feature = {
        ...raw(1),
        properties: { [idField]: 1, [curated.nameField]: 'Named trail' },
      };
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
        const url = new URL(String(input));
        expect(url.searchParams.get('geometry')).toBe(bounds.join(','));
        expect(url.searchParams.get('inSR')).toBe('4326');
        expect(url.searchParams.get('spatialRel')).toBe('esriSpatialRelIntersects');
        return json(
          url.searchParams.get('returnIdsOnly') === 'true'
            ? { objectIdFieldName: idField, objectIds: [1] }
            : collection([feature]),
        );
      });
      const download = await downloadFeatureSource(curated, bounds, signal(), fetcher);
      expect(download.geojson.feature_class).toBe('trail');
      expect(download.geojson.name_field).toBe(curated.nameField);
      expect(download.geojson.features[0].properties[curated.nameField]).toBe('Named trail');
      expect(download.ids).toEqual(['1']);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects incomplete ArcGIS batches instead of returning a partial replacement', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ objectIdFieldName: 'OBJECTID', objectIds: [1, 2] }))
      .mockResolvedValueOnce(json(collection([raw(1)])));
    await expect(
      downloadFeatureSource(defaultFeatureSources[1], bounds, signal(), fetcher),
    ).rejects.toThrow('incomplete batch');
  });
  it.each([null, []])(
    'accepts an empty ArcGIS area without requesting geometries',
    async objectIds => {
      const fetcher = fetchData({ objectIdFieldName: 'OBJECTID', objectIds });
      const download = await downloadFeatureSource(
        defaultFeatureSources[2],
        bounds,
        signal(),
        fetcher,
      );
      expect(download.geojson.features).toEqual([]);
      expect(download.ids).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects a malformed empty ID response instead of clearing the source', async () => {
    await expect(
      downloadFeatureSource(
        defaultFeatureSources[2],
        bounds,
        signal(),
        fetchData({ objectIds: null }),
      ),
    ).rejects.toThrow('complete list');
  });
  it.each([
    [collection([raw(1), raw(1)]), 'duplicate'],
    [{ ...collection([raw(1)]), exceededTransferLimit: true }, 'part of its data'],
    [{ ...collection([raw(1)]), crs: { properties: { name: 'EPSG:2913' } } }, 'WGS84'],
    [
      collection([
        {
          ...raw(1),
          geometry: {
            type: 'LineString',
            coordinates: [
              [100000, 45],
              [100001, 46],
            ],
          },
        },
      ]),
      'WGS84',
    ],
    [{ type: 'NotGeoJSON' }, 'GeoJSON'],
  ])('rejects malformed or incomplete data', async (data, message) => {
    await expect(downloadFeatureSource(source, bounds, signal(), fetchData(data))).rejects.toThrow(
      message as string,
    );
  });
  it('rejects oversized responses, HTTP failures, and inaccessible endpoints with useful errors', async () => {
    await expect(
      downloadFeatureSource(
        source,
        bounds,
        signal(),
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('{}', { headers: { 'content-length': '50000001' } })),
      ),
    ).rejects.toThrow('50 MB');
    await expect(
      downloadFeatureSource(
        source,
        bounds,
        signal(),
        vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
      ),
    ).rejects.toThrow('HTTP 404');
    await expect(
      downloadFeatureSource(
        source,
        bounds,
        signal(),
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
      ),
    ).rejects.toThrow('CORS');
  });
  it('cancels in-flight work and rejects a response that arrives after cancellation', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      return json(collection([raw(1)]));
    });
    await expect(
      downloadFeatureSource(source, bounds, controller.signal, fetcher),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

it('refreshes only one source, removes stale records, and preserves model edits', async () => {
  const download = await downloadFeatureSource(
    source,
    bounds,
    signal(),
    fetchData(collection([raw(1)])),
  );
  const incoming = identifySourceFeatures(source, download, [normalized()]);
  const old = { ...incoming[0], enabled: false, treatment: 'v_carve' as const, width_m: 12 };
  const stale = { ...incoming[0], id: 'source:custom:test:removed' };
  const other = normalized('osm:way:1');
  const result = mergeSourceFeatures([other, old, stale], incoming, source);
  expect(result).toHaveLength(2);
  expect(result[0]).toBe(other);
  expect(result[1]).toMatchObject({ enabled: false, treatment: 'v_carve', width_m: 12 });
  expect(mergeSourceFeatures(result, incoming, source)).toEqual(result);
  expect(mergeSourceFeatures(result, [], source)).toEqual([other]);
});

it('refreshes HRC trails already embedded in the default preset without duplicating them', async () => {
  const hrc = defaultFeatureSources[1];
  const download = { geojson: { type: 'FeatureCollection' as const, features: [] }, ids: ['1'] };
  const incoming = identifySourceFeatures(hrc, download, [normalized()]);
  const bundled = { ...normalized('county-trail:1'), enabled: false };
  expect(mergeSourceFeatures([bundled], incoming, hrc)).toMatchObject([
    { id: 'county-trail:1', enabled: false },
  ]);
});

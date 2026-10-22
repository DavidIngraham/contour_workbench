/** User-managed feature sources, bounded downloads, and source-aware refreshes. */
import { featureClasses, type Bounds, type Feature, type FeatureClass } from './types';

/** Unique credits saved with source features, including those in reopened projects. */
export function featureSourceAttribution(features: Feature[]): string {
  return [
    ...new Set(
      features.flatMap(feature => {
        const source = feature.tags.contour_source as { attribution?: unknown } | undefined;
        return typeof source?.attribution === 'string' ? [source.attribution] : [];
      }),
    ),
  ].join('\n');
}

/** A library entry; definitions are browser preferences, not project dependencies. */
export interface FeatureSource {
  id: string;
  name: string;
  kind: 'overpass' | 'geojson' | 'arcgis';
  url: string;
  featureClass: 'auto' | FeatureClass;
  nameField: string;
  /** Curated coverage and import guidance shown beside the source selector. */
  description?: string;
  /** Attribution retained with imported features and included in exports. */
  attribution?: string;
}

/** Curated sources available without configuring an endpoint. */
export const defaultFeatureSources: readonly FeatureSource[] = [
  {
    id: 'overpass',
    name: 'OpenStreetMap · Overpass',
    kind: 'overpass',
    url: '',
    featureClass: 'auto',
    nameField: '',
    description: 'Worldwide trails, roads, water, and winter features from OpenStreetMap.',
  },
  {
    id: 'hrc',
    name: 'Hood River County · recreation trails',
    kind: 'arcgis',
    url: 'https://services7.arcgis.com/xtfQPw7zwSRPkcfN/ArcGIS/rest/services/Recreational_Trails_Public/FeatureServer/134',
    featureClass: 'auto',
    nameField: '',
    description:
      'County recreation trails intersecting your terrain. Closed and future trails are excluded.',
  },
  {
    id: 'usfs',
    name: 'US Forest Service · trails',
    kind: 'arcgis',
    url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0',
    featureClass: 'trail',
    nameField: 'trail_name',
    description:
      'National forest trails intersecting your terrain. Coverage and trail details vary by forest.',
  },
  {
    id: 'nps',
    name: 'National Park Service · trails',
    kind: 'arcgis',
    url: 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0',
    featureClass: 'trail',
    nameField: 'TRLNAME',
    description: 'Public national park trails intersecting your terrain.',
  },
  {
    id: 'blm',
    name: 'Bureau of Land Management · public trails',
    kind: 'arcgis',
    url: 'https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation/MapServer/7',
    featureClass: 'trail',
    nameField: 'ROUTE_PRMRY_NM',
    description:
      'BLM trails managed for public use intersecting your terrain. Unassessed routes are excluded.',
  },
  {
    id: 'wa-rco',
    name: 'Washington State · trails',
    kind: 'arcgis',
    url: 'https://services2.arcgis.com/TGEC20q86HQAeMS6/arcgis/rest/services/WA_RCO_Trails_Database_Public_View/FeatureServer/0',
    featureClass: 'trail',
    nameField: 'trail_name',
    description:
      'Washington trails from local, state, and federal land managers, limited to your terrain area.',
  },
  {
    id: 'openskimap',
    name: 'OpenSkiMap · ski runs and lifts',
    kind: 'geojson',
    url: 'https://api.openskimap.org/features.geojson?bbox={bbox}&types=run,lift',
    featureClass: 'auto',
    nameField: 'name',
    description:
      'Ski runs and lifts in your terrain area, up to 1,000 km². Includes downhill, Nordic, and ski touring routes; inactive features are excluded.',
    attribution:
      "Data from OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL), Skimap.org, Who's On First, © Mapterhorn. https://www.openskidata.org/",
  },
];
const storageKey = 'contour-feature-sources-v1';
const maxFeatures = 20_000;
const maxBytes = 50_000_000;
const arcgisLayer = /\/(?:FeatureServer|MapServer)\/\d+(?:\/query)?\/?$/i;

/** Validate a public endpoint and create a stable library identity. */
export function customFeatureSource(
  name: string,
  endpoint: string,
  featureClass: string,
  nameField = '',
  id = `custom:${crypto.randomUUID()}`,
): FeatureSource {
  const url = endpoint.trim();
  let parsed: URL;
  try {
    parsed = new URL(url.replaceAll('{bbox}', '-122,45,-121,46'));
  } catch {
    throw new Error('Enter a complete HTTPS GeoJSON or ArcGIS layer URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash)
    throw new Error('Use an HTTPS URL without a username, password, or fragment.');
  if (/[{}]/.test(url.replaceAll('{bbox}', '')))
    throw new Error('The only supported URL placeholder is {bbox}.');
  if (!name.trim() || name.trim().length > 100)
    throw new Error('Enter a source name of up to 100 characters.');
  if (url.length > 4096 || nameField.length > 100)
    throw new Error('The source URL or name field is too long.');
  if (featureClass !== 'auto' && !featureClasses.includes(featureClass as FeatureClass))
    throw new Error('Choose a supported feature type.');
  if (!/^custom:[\w-]+$/.test(id)) throw new Error('Invalid custom source identifier.');
  return {
    id,
    name: name.trim(),
    url,
    kind: arcgisLayer.test(parsed.pathname) ? 'arcgis' : 'geojson',
    featureClass: featureClass as FeatureSource['featureClass'],
    nameField: nameField.trim(),
  };
}

/** Read valid custom entries while tolerating unavailable or damaged browser storage. */
export function readFeatureSources(storage: Pick<Storage, 'getItem'>): FeatureSource[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved)) return [];
    const result: FeatureSource[] = [];
    for (const entry of saved.slice(0, 50)) {
      try {
        if (typeof entry?.id !== 'string') continue;
        const source = customFeatureSource(
          entry.name,
          entry.url,
          entry.featureClass,
          entry.nameField ?? '',
          entry.id,
        );
        if (!result.some(item => item.id === source.id)) result.push(source);
      } catch {
        /* Ignore one invalid preference without losing the remaining library. */
      }
    }
    return result;
  } catch {
    return [];
  }
}

/** Save custom entries; report storage failures instead of claiming they were saved. */
export function saveFeatureSources(storage: Pick<Storage, 'setItem'>, sources: FeatureSource[]) {
  if (sources.length > 50) throw new Error('The library can hold up to 50 custom sources.');
  try {
    storage.setItem(storageKey, JSON.stringify(sources));
  } catch {
    throw new Error(
      'Your browser could not save the source library. Enable site storage and try again.',
    );
  }
}

interface GeoFeature {
  type: 'Feature';
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}
/** Validated geographic features and their stable source identifiers. */
export interface SourceDownload {
  geojson: {
    type: 'FeatureCollection';
    features: GeoFeature[];
    feature_class?: FeatureClass;
    name_field?: string;
  };
  ids: string[];
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateGeojson(data: unknown, bounds: Bounds): GeoFeature[] {
  if (!record(data) || !['FeatureCollection', 'Feature'].includes(data.type))
    throw new Error('The endpoint must return GeoJSON features, not a web map or an HTML page.');
  if (
    data.exceededTransferLimit ||
    data.properties?.exceededTransferLimit ||
    (Array.isArray(data.links) && data.links.some((link: any) => link?.rel === 'next'))
  )
    throw new Error(
      'The endpoint returned only part of its data. Use an ArcGIS layer URL or a complete GeoJSON download.',
    );
  if (data.crs && !/(?:4326|CRS84)$/i.test(data.crs.properties?.name ?? ''))
    throw new Error('GeoJSON must use WGS84 longitude/latitude coordinates (EPSG:4326).');
  const features = data.type === 'Feature' ? [data] : data.features;
  if (!Array.isArray(features) || features.length > maxFeatures)
    throw new Error('Choose an area or source with at most 20,000 features.');
  let vertices = 0;
  const result: GeoFeature[] = [];
  for (const feature of features) {
    if (
      !record(feature) ||
      feature.type !== 'Feature' ||
      (feature.properties != null && !record(feature.properties))
    )
      throw new Error('The source contains an invalid GeoJSON feature.');
    const geometry = feature.geometry;
    if (geometry == null) continue;
    if (!record(geometry)) throw new Error('The source contains an invalid geometry.');
    if (['Point', 'MultiPoint'].includes(geometry.type)) continue;
    const depth = (
      { LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 } as Record<string, number>
    )[geometry.type];
    if (!depth)
      throw new Error(
        'Use GeoJSON line or polygon geometries. Geometry collections are not supported.',
      );
    const extent = [Infinity, Infinity, -Infinity, -Infinity];
    const scan = (value: unknown, level: number) => {
      if (!Array.isArray(value)) throw new Error('The source contains invalid coordinates.');
      if (level) {
        for (const child of value) scan(child, level - 1);
        return;
      }
      const [lon, lat] = value;
      if (
        typeof lon !== 'number' ||
        typeof lat !== 'number' ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        Math.abs(lon) > 180 ||
        Math.abs(lat) > 90
      )
        throw new Error('GeoJSON must contain finite WGS84 longitude/latitude coordinates.');
      if (++vertices > 500_000)
        throw new Error(
          'This source has too many coordinates. Use a smaller area or a filtered endpoint.',
        );
      extent[0] = Math.min(extent[0], lon);
      extent[1] = Math.min(extent[1], lat);
      extent[2] = Math.max(extent[2], lon);
      extent[3] = Math.max(extent[3], lat);
    };
    scan(geometry.coordinates, depth);
    if (
      extent[0] <= bounds[2] &&
      extent[2] >= bounds[0] &&
      extent[1] <= bounds[3] &&
      extent[3] >= bounds[1]
    )
      result.push({
        type: 'Feature',
        id: feature.id,
        properties: feature.properties ?? {},
        geometry: geometry as GeoFeature['geometry'],
      });
  }
  return result;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(key => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

async function featureKey(feature: GeoFeature): Promise<string> {
  const id =
    feature.id ??
    feature.properties.OBJECTID ??
    feature.properties.GlobalID ??
    feature.properties.id;
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical([feature.geometry, feature.properties])),
  );
  return (
    'sha256-' +
    Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  );
}

/** Fetch a complete, bounded source snapshot; ArcGIS uses ID batches to avoid truncation. */
export async function downloadFeatureSource(
  source: FeatureSource,
  bounds: Bounds,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SourceDownload> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error('The source took too long to respond. Try again or select a smaller area.'),
      ),
    60_000,
  );
  let bytes = 0;
  const request = async (url: URL) => {
    controller.signal.throwIfAborted();
    const response = await fetcher(url.toString(), {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok)
      throw new Error(
        `The feature source returned HTTP ${response.status}. Check the URL and try again.`,
      );
    if (Number(response.headers.get('content-length')) + bytes > maxBytes) {
      await response.body?.cancel();
      throw new Error('The feature download exceeds 50 MB. Use a smaller area or filtered URL.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The feature source returned an empty response.');
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes)
          throw new Error(
            'The feature download exceeds 50 MB. Use a smaller area or filtered URL.',
          );
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('The endpoint did not return valid JSON. Use a direct GeoJSON download URL.');
    }
    if (data?.error)
      throw new Error(
        'The map service rejected this query. Check that the layer is public and supports GeoJSON.',
      );
    return data;
  };
  try {
    if (source.id === 'openskimap') {
      // Match the service's equirectangular area calculation; do not evade its cap by tiling.
      const area =
        (bounds[2] - bounds[0]) *
        (bounds[3] - bounds[1]) *
        111.32 ** 2 *
        Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180);
      if (!Number.isFinite(area) || area <= 0 || area > 1000)
        throw new Error(
          'OpenSkiMap supports terrain areas up to 1,000 km². Select a smaller terrain area.',
        );
    }
    const url = new URL(source.url.replaceAll('{bbox}', bounds.join(',')));
    let features: GeoFeature[];
    if (source.kind === 'arcgis') {
      url.pathname = url.pathname.replace(/\/query\/?$/i, '').replace(/\/$/, '') + '/query';
      for (const key of [
        'returnCountOnly',
        'returnExtentOnly',
        'resultOffset',
        'resultRecordCount',
        'objectIds',
        'outStatistics',
        'groupByFieldsForStatistics',
      ])
        url.searchParams.delete(key);
      const set = (params: Record<string, string>) => {
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      };
      set({
        where: url.searchParams.get('where') || '1=1',
        geometry: bounds.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        returnIdsOnly: 'true',
        f: 'json',
      });
      const result = await request(url);
      // ArcGIS Enterprise uses null for a successful ID query with no matches.
      const objectIds =
        result?.objectIds === null && typeof result.objectIdFieldName === 'string'
          ? []
          : result?.objectIds;
      if (
        !Array.isArray(objectIds) ||
        result.exceededTransferLimit ||
        objectIds.length > maxFeatures
      )
        throw new Error(
          'The map service did not return a complete list of features. Select a smaller area.',
        );
      if (
        objectIds.some((id: unknown) => !Number.isSafeInteger(id)) ||
        new Set(objectIds).size !== objectIds.length
      )
        throw new Error('The map service returned invalid or duplicate feature IDs.');
      features = [];
      set({
        returnIdsOnly: 'false',
        returnGeometry: 'true',
        outFields: '*',
        outSR: '4326',
        f: 'geojson',
      });
      for (let offset = 0; offset < objectIds.length; offset += 200) {
        const batch = objectIds.slice(offset, offset + 200);
        set({ objectIds: batch.join(',') });
        const data = await request(url);
        const page = validateGeojson(data, bounds);
        const ids = page.map(f => f.properties[result.objectIdFieldName] ?? f.id);
        if (
          page.length !== batch.length ||
          new Set(ids).size !== batch.length ||
          !ids.every(id => batch.includes(id))
        )
          throw new Error(
            'The map service returned an incomplete batch. Your current features are unchanged; try again.',
          );
        features.push(...page);
      }
    } else {
      features = validateGeojson(await request(url), bounds);
    }
    // Enforce the coordinate budget across all ArcGIS batches as well as single files.
    if (source.kind === 'arcgis')
      features = validateGeojson({ type: 'FeatureCollection', features }, bounds);
    let ids = await Promise.all(features.map(featureKey));
    if (source.id === 'openskimap') {
      // Build IDs from upstream sources: OpenSkiMap's IDs change on every content update.
      // Split features can share sources, so ambiguous groups retain a content-ID suffix.
      const upstream = features.map(feature => {
        const sources = feature.properties.sources;
        if (!Array.isArray(sources) || !sources.length) return undefined;
        if (
          !sources.every(
            s =>
              record(s) &&
              typeof s.type === 'string' &&
              (typeof s.id === 'string' || typeof s.id === 'number'),
          )
        )
          return undefined;
        return canonical([
          feature.properties.type,
          [...new Set(sources.map(s => `${s.type}:${s.id}`))].sort(),
        ]);
      });
      const counts = new Map<string, number>();
      for (const key of upstream) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      ids = ids.map((id, index) => {
        const key = upstream[index];
        return key
          ? `upstream:${key}${counts.get(key)! > 1 ? `:part:${id}` : ''}`
          : `content:${id}`;
      });
    }
    if (new Set(ids).size !== ids.length)
      throw new Error('The source contains duplicate feature IDs. Each feature needs a unique ID.');
    controller.signal.throwIfAborted();
    return {
      geojson: {
        type: 'FeatureCollection',
        features,
        ...(source.featureClass !== 'auto' ? { feature_class: source.featureClass } : {}),
        ...(source.nameField ? { name_field: source.nameField } : {}),
      },
      ids,
    };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TypeError)
      throw new Error(
        'The source could not be reached. It must allow browser access (CORS). You can also download its GeoJSON and upload the file.',
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

/** Attach provenance and stable IDs after the Rust importer classifies the snapshot. */
export function identifySourceFeatures(
  source: FeatureSource,
  download: SourceDownload,
  features: Feature[],
): Feature[] {
  return features.map(feature => {
    const index = Number(feature.id.replace(/^upload:/, ''));
    const id = download.ids[index];
    if (id == null) throw new Error('The imported feature could not be linked to its source.');
    return {
      ...feature,
      id:
        source.id === 'hrc'
          ? `county-trail:${id}`
          : `source:${source.id}:${encodeURIComponent(id)}`,
      tags: {
        ...feature.tags,
        contour_source: {
          id: source.id,
          name: source.name,
          url: source.url,
          ...(source.attribution ? { attribution: source.attribution } : {}),
        },
      },
    };
  });
}

/** Replace only this source's snapshot and retain matching user customizations. */
export function mergeSourceFeatures(
  existing: Feature[],
  incoming: Feature[],
  source: FeatureSource,
): Feature[] {
  const owned = (feature: Feature) =>
    (feature.tags.contour_source as { id?: string } | undefined)?.id === source.id ||
    (source.id === 'hrc' && feature.id.startsWith('county-trail:'));
  const old = new Map(existing.filter(owned).map(feature => [feature.id, feature]));
  return [
    ...existing.filter(feature => !owned(feature)),
    ...incoming.map(feature => {
      const previous = old.get(feature.id);
      if (!previous) return feature;
      return {
        ...feature,
        enabled: previous.enabled,
        treatment: previous.treatment,
        surface: previous.surface,
        width_m: previous.width_m,
        insert_depth_mm: previous.insert_depth_mm,
      };
    }),
  ];
}

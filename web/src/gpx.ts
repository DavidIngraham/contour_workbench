/** Convert GPX tracks and routes into editable project features. */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Feature } from './types';

type Point = { '@_lat'?: string; '@_lon'?: string };
type Path = { name?: unknown; trkseg?: { trkpt?: Point[] }[]; rtept?: Point[] };

/** Preserve track segment breaks and ignore elevation in favor of the project's terrain. */
export function parseGpx(xml: string, filename: string): Feature[] {
  const fail = (message: string): never => {
    throw new Error(`${filename}: ${message}`);
  };
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    fail('This is not a valid GPX file.');
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: name => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept'].includes(name),
  }).parse(xml);
  if (!parsed.gpx || typeof parsed.gpx !== 'object')
    fail('This is not a GPX file containing tracks or routes.');

  const line = (points: Point[] = []): [number, number][] => {
    const result: [number, number][] = [];
    for (const point of points) {
      const lat = Number(point?.['@_lat']);
      const lon = Number(point?.['@_lon']);
      if (
        !point?.['@_lat']?.trim() ||
        !point?.['@_lon']?.trim() ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        fail('A track or route point has missing or invalid latitude/longitude.');
      const previous = result.at(-1);
      if (!previous || previous[0] !== lon || previous[1] !== lat) result.push([lon, lat]);
    }
    return result;
  };
  const features: Feature[] = [];
  const stem = filename.replace(/\.gpx$/i, '').trim() || 'GPX';
  for (const [kind, paths] of [
    ['Track', parsed.gpx.trk ?? []],
    ['Route', parsed.gpx.rte ?? []],
  ] as [string, Path[]][]) {
    paths.forEach((path, index) => {
      const lines = (
        kind === 'Track'
          ? (path.trkseg ?? []).map(segment => line(segment.trkpt))
          : [line(path.rtept)]
      ).filter(points => points.length >= 2);
      if (!lines.length) return;
      features.push({
        id: `gpx:${crypto.randomUUID()}`,
        name:
          (typeof path.name === 'string' && path.name.trim()) || `${stem} · ${kind} ${index + 1}`,
        class: 'trail',
        lines,
        polygons: [],
        enabled: true,
        treatment: 'insert',
        tags: { source: 'gpx', filename },
      });
    });
  }
  if (!features.length)
    fail(
      'No usable tracks or routes found. Each needs at least two distinct points; waypoints alone are not supported.',
    );
  return features;
}

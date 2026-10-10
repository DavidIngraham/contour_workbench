import { describe, expect, it } from 'vitest';
import { parseGpx } from '../src/gpx';

const points = '<trkpt lat="45" lon="-122"/><trkpt lat="45.1" lon="-121.9"/>';

describe('GPX import', () => {
  it('imports named tracks and routes, preserving disconnected segments and longitude first', () => {
    const features = parseGpx(
      `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>Ridge &amp; River</name><trkseg>${points}</trkseg>
          <trkseg><trkpt lat="46" lon="-123"><ele>800</ele></trkpt><trkpt lat="46.1" lon="-123.1"/></trkseg></trk>
        <rte><name>Return</name><rtept lat="45" lon="-122"/><rtept lat="45.2" lon="-122.2"/></rte>
      </gpx>`,
      'ride.gpx',
    );
    expect(features.map(feature => feature.name)).toEqual(['Ridge & River', 'Return']);
    expect(features[0].lines).toEqual([
      [
        [-122, 45],
        [-121.9, 45.1],
      ],
      [
        [-123, 46],
        [-123.1, 46.1],
      ],
    ]);
    expect(features[1].lines).toEqual([
      [
        [-122, 45],
        [-122.2, 45.2],
      ],
    ]);
    expect(
      features.every(
        feature => feature.enabled && feature.class === 'trail' && feature.treatment === 'insert',
      ),
    ).toBe(true);
  });

  it('uses filename fallbacks and unique IDs even for repeated imports', () => {
    const xml = `<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg>${points}</g:trkseg></g:trk><g:trk><g:trkseg>${points}</g:trkseg></g:trk></g:gpx>`;
    const first = parseGpx(xml, 'Weekend.GPX');
    const second = parseGpx(xml, 'Weekend.GPX');
    expect(first.map(feature => feature.name)).toEqual(['Weekend · Track 1', 'Weekend · Track 2']);
    expect(new Set([...first, ...second].map(feature => feature.id)).size).toBe(4);
  });

  it('skips empty and one-point segments without connecting them', () => {
    const [feature] = parseGpx(
      `<gpx><trk><trkseg/><trkseg><trkpt lat="40" lon="-120"/></trkseg><trkseg>${points}</trkseg></trk></gpx>`,
      'segments.gpx',
    );
    expect(feature.lines).toEqual([
      [
        [-122, 45],
        [-121.9, 45.1],
      ],
    ]);
  });

  it.each(['<gpx><trk></gpx>', '<other/>', '<!DOCTYPE gpx [<!ENTITY name "test">]><gpx/>'])(
    'rejects malformed or non-GPX XML',
    xml => {
      expect(() => parseGpx(xml, 'bad.gpx')).toThrow(/bad.gpx:.*GPX/);
    },
  );

  it.each(['', 'NaN', '91', 'Infinity'])('rejects invalid latitude %s', lat => {
    expect(() =>
      parseGpx(
        `<gpx><trk><trkseg><trkpt lat="${lat}" lon="0"/>${points}</trkseg></trk></gpx>`,
        'bad.gpx',
      ),
    ).toThrow(/invalid latitude\/longitude/);
  });

  it.each([
    '<wpt lat="45" lon="-122"/>',
    '<trk><trkseg><trkpt lat="45" lon="-122"/><trkpt lat="45" lon="-122"/></trkseg></trk>',
    '<rte/>',
  ])('rejects files without a drawable track or route', content => {
    expect(() => parseGpx(`<gpx>${content}</gpx>`, 'empty.gpx')).toThrow(
      /No usable tracks or routes/,
    );
  });
});

import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { decodeMesh, validatePresetLinks } from '../src/presets';
import type { Feature } from '../src/types';

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

it('keeps the Post Canyon fixture and preset aligned with the county trail export', () => {
  const source = readJson('../../tests/resources/post_canyon.geojson');
  const example = readJson('../../tests/resources/post_canyon_example.json');
  const files = unzipSync(
    readFileSync(new URL('../public/examples/presets/post-canyon.cwpack', import.meta.url)),
  );
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  const project = manifest.project;
  const trails: Feature[] = project.features.filter((f: Feature) => f.class === 'trail');
  const countyFeatures = example.geojson.features.filter(
    (f: { properties: { OBJECTID?: number } }) => f.properties.OBJECTID != null,
  );
  expect(countyFeatures).toEqual(source.features);
  const active = source.features.filter(
    (f: { properties: { Difficulty: string } }) =>
      !/Closed|Future|Concept/.test(f.properties.Difficulty),
  );
  expect(trails).toHaveLength(active.length);
  for (const feature of active) {
    const trail = trails.find(f => f.tags.OBJECTID === feature.properties.OBJECTID);
    expect(trail).toBeDefined();
    expect(trail!.id).toBe(`county-trail:${feature.properties.OBJECTID}`);
    expect(trail!.name).toBe(feature.properties.Trail_Name || feature.properties.Name);
    // JSON round trips through Rust may differ by one floating-point ULP.
    expect(trail!.tags).toEqual({
      ...feature.properties,
      Distance: expect.closeTo(feature.properties.Distance, 8),
    });
    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    expect(trail!.lines).toEqual(
      lines.map((line: number[][]) =>
        line.map(point => point.map(coordinate => expect.closeTo(coordinate, 10))),
      ),
    );
  }
  expect(project.features.filter((f: Feature) => f.class === 'road')).toHaveLength(65);
  expect(project.features.filter((f: Feature) => f.class === 'stream')).toHaveLength(298);
  expect(new Set(project.features.map((f: Feature) => f.id)).size).toBe(project.features.length);
  expect(() => validatePresetLinks(project, manifest.overlays)).not.toThrow();
  expect(manifest.overlays.length).toBeGreaterThan(0);
  for (const overlay of manifest.overlays) {
    expect(decodeMesh(files[overlay.mesh]).indices.length).toBeGreaterThan(0);
  }
  const catalog = readJson('../public/examples/catalog.json');
  const entry = catalog.models.find((model: { id: string }) => model.id === 'post-canyon');
  expect(entry.badges).toContain(`${project.features.length} features`);
  expect(entry.revision).toBeGreaterThan(3);
});

import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bambuProcessSettings, buildThreeMf } from '../src/three-mf';
import { defaults, type Asset, type Mesh, type Project } from '../src/types';

function box(width: number, depth: number, height: number): Mesh {
  return {
    positions: [
      0,
      0,
      0,
      width,
      0,
      0,
      width,
      depth,
      0,
      0,
      depth,
      0,
      0,
      0,
      height,
      width,
      0,
      height,
      width,
      depth,
      height,
      0,
      depth,
      height,
    ],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
      0, 4, 3, 4, 7,
    ],
  };
}
const project: Project = {
  schema_version: 2,
  name: 'Meadows / winter',
  grid: { bounds: [0, 0, 1, 1], width: 2, height: 2, elevations: [0, 0, 0, 0] },
  source: { product: 'test', name: 'Test', retrieved: 'today', attribution: 'Test data' },
  features: [],
  settings: { ...defaults, max_print_size_mm: [60, 60], nozzle_diameter_mm: 0.4 },
};
const asset: Asset = {
  terrain: box(50, 50, 5),
  inserts: [
    {
      id: 'lake & one',
      class: 'water',
      mesh: box(25, 25, 2),
      origin: [10, 20, 5],
      insert_depth_mm: 1,
    },
    {
      id: 'ski run',
      class: 'ski_run',
      mesh: box(25, 25, 2),
      origin: [20, 10, 5],
      insert_depth_mm: 1,
    },
  ],
  validation: { watertight: true, triangles: 12, pieces: 2, removed_terrain_islands: 0 },
  revision: 1,
};

describe('3MF export', () => {
  it('creates a portable assembled package with standard 3MF parts', () => {
    const files = unzipSync(buildThreeMf(asset, project, 'portable'));
    expect(files['[Content_Types].xml']).toBeDefined();
    expect(files['_rels/.rels']).toBeDefined();
    expect(files['3D/3dmodel.model']).toBeDefined();
    expect(files['Metadata/project_settings.config']).toBeUndefined();
    expect(JSON.parse(strFromU8(files['Metadata/project.contour.json'])).name).toBe(project.name);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<object /g)).toHaveLength(3);
    expect(model.match(/<item /g)).toHaveLength(3);
    expect(model).toContain('10.000000 20.000000 5.000000');
    expect(model).toContain('lake &amp; one');
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.format).toBe('portable');
    expect(manifest.plates).toHaveLength(1);
  });
  it('creates a Bambu multi-plate package and nozzle-derived process settings', () => {
    const files = unzipSync(buildThreeMf(asset, project, 'bambu'));
    const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(settings).toEqual(bambuProcessSettings(project));
    expect(settings.layer_height).toBe('0.20');
    expect(settings.elefant_foot_compensation).toBe('0');
    const modelSettings = strFromU8(files['Metadata/model_settings.config']);
    expect(modelSettings.match(/<plate>/g)).toHaveLength(2);
    expect(modelSettings).toContain('plater_name" value="Terrain');
    expect(modelSettings).toContain('plater_name" value="Inserts 1');
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.format).toBe('bambu');
    expect(manifest.plates.map((plate: { plate: number }) => plate.plate)).toEqual([1, 2]);
    expect(manifest.plates[0].objects).toEqual(['Terrain']);
    expect(manifest.plates[1].objects).toEqual(['lake & one', 'ski run']);
  });
  it('rejects invalid triangle references before creating an archive', () => {
    const broken: Asset = {
      ...asset,
      terrain: { ...asset.terrain, indices: [0, 1, 999] },
    };
    expect(() => buildThreeMf(broken, project, 'portable')).toThrow('out-of-range triangle index');
  });
});

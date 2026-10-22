import { strFromU8, unzipSync, unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildExport, validateShapewaysLimits, validateWatertight } from '../src/export-formats';
import { defaults, type Asset, type Mesh, type Project } from '../src/types';

function box(): Mesh {
  return {
    positions: [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0, 0, 0, 2, 2, 0, 2, 2, 2, 2, 0, 2, 2],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
      0, 4, 3, 4, 7,
    ],
  };
}
const project: Project = {
  schema_version: 2,
  name: 'Color terrain',
  grid: { bounds: [0, 0, 1, 1], width: 2, height: 2, elevations: [0, 0, 0, 0] },
  source: { product: 'test', name: 'Test', retrieved: 'today', attribution: 'Test' },
  features: [],
  settings: { ...defaults, manufacturing_mode: 'multicolor' },
  materials: [
    { id: 'terrain', name: 'Ground', color: '#112233', extruder: 1 },
    { id: 'features', name: 'Water', color: '#abcdef', extruder: 3 },
  ],
};
const asset: Asset = {
  terrain: box(),
  inserts: [{ id: 'lake one', class: 'water', mesh: box(), origin: [3, 4, 2], insert_depth_mm: 1 }],
  validation: { watertight: true, triangles: 12, pieces: 1, removed_terrain_islands: 0 },
  revision: 1,
};

describe('target export formats', () => {
  it.each(['stl', 'portable', 'bambu', 'prusa', 'shapeways-color'] as const)(
    'retains imported source credits once in %s exports',
    format => {
      const credits = 'Data from OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors';
      const files = unzipSync(
        buildExport(format, asset, {
          ...project,
          features: ['run', 'lift'].map(id => ({
            id,
            name: id,
            class: 'ski_run',
            lines: [],
            enabled: true,
            tags: { contour_source: { attribution: credits } },
          })),
        }).bytes,
      );
      const path =
        format === 'stl'
          ? 'attribution.txt'
          : format === 'shapeways-color'
            ? 'README.txt'
            : 'Metadata/attribution.txt';
      expect(strFromU8(files[path]).split(credits)).toHaveLength(2);
      expect(strFromU8(files[path])).toContain(project.source.attribution);
    },
  );

  it('keeps STL parts aligned only for print-together mode', () => {
    for (const mode of ['separate', 'multicolor'] as const) {
      const files = unzipSync(
        buildExport('stl', asset, {
          ...project,
          settings: { ...project.settings, manufacturing_mode: mode },
        }).bytes,
      );
      const mesh = strFromU8(files['inserts/lake one.stl']);
      expect(mesh).toContain(mode === 'multicolor' ? 'vertex 3 4 2\n' : 'vertex 0 0 0\n');
      const manifest = JSON.parse(strFromU8(files['insert_manifest.json']));
      expect(manifest.coordinates).toBe(mode === 'multicolor' ? 'assembly' : 'part-local');
      expect(manifest.pieces[0].assembly_origin_mm).toEqual([3, 4, 2]);
      expect(strFromU8(files['README.txt'])).toContain(
        mode === 'multicolor'
          ? 'preserve their coordinates'
          : 'print terrain and insert files separately',
      );
    }
  });

  it.each(['portable', 'prusa'] as const)(
    'exports separate inserts as independent grounded objects in %s',
    format => {
      const files = unzipSync(
        buildExport(format, asset, {
          ...project,
          settings: { ...project.settings, manufacturing_mode: 'separate' },
        }).bytes,
      );
      const model = strFromU8(files['3D/3dmodel.model']);
      expect(model.match(/<item /g)).toHaveLength(2);
      expect(model).not.toContain('<component ');
      expect(model).toContain('7.000000 0.000000 0.000000');
      expect(model).not.toContain('3.000000 4.000000 2.000000');
      if (format === 'prusa')
        expect(strFromU8(files['Metadata/Slic3r_PE_layer_heights_profile.txt'])).toContain(
          'object_id=2|',
        );
    },
  );

  it('creates the exact Shapeways color archive with linked material and texture files', () => {
    const result = buildExport('shapeways-color', asset, project);
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'colors.png',
      'model.mtl',
      'model.obj',
    ]);
    expect([...files['colors.png'].slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(strFromU8(files['model.obj'])).toContain('mtllib model.mtl');
    expect(strFromU8(files['model.obj'])).toContain('v 3 4 2');
    expect(strFromU8(files['model.mtl'])).toContain('map_Kd colors.png');
  });

  it('creates one Prusa build object with aligned component transforms and extruders', () => {
    const files = unzipSync(buildExport('prusa', asset, project).bytes);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<item /g)).toHaveLength(1);
    expect(model.match(/<component /g)).toHaveLength(2);
    const resourceIds = [...model.matchAll(/<(?:object|basematerials)\b[^>]*\bid="(\d+)"/g)].map(
      match => match[1],
    );
    expect(new Set(resourceIds).size).toBe(resourceIds.length);
    expect(model).toContain('3.000000 4.000000 2.000000');
    expect(model).toContain('<metadata name="slic3rpe:extruder_id">3</metadata>');
    expect(model).toContain('<metadata name="slic3rpe:Version3mf">1</metadata>');
    const config = strFromU8(files['Metadata/Slic3r_PE.config']);
    expect(config).toContain('; variable_layer_height = 1');
    expect(config).toContain('; wipe_tower = 0');
    expect(config).toContain('; layer_height = 0.20');
    expect(config).toContain('; fill_density = 5%');
    expect(config).toContain('; fill_pattern = gyroid');
    expect(config).not.toContain('elefant_foot_compensation');
    const profile = strFromU8(files['Metadata/Slic3r_PE_layer_heights_profile.txt']);
    expect(profile).toMatch(/^object_id=1\|/);
    const profileValues = profile
      .slice(profile.indexOf('|') + 1)
      .trim()
      .split(';')
      .map(Number);
    const layerHeights = profileValues.filter((_, index) => index % 2 === 1);
    expect(new Set(layerHeights).size).toBeGreaterThan(1);
    expect(Math.min(...layerHeights)).toBeGreaterThanOrEqual(0.04);
  });

  it('keeps Bambu multicolor parts on one plate with separate extruders', () => {
    const files = unzipSync(buildExport('bambu', asset, project).bytes);
    const settings = strFromU8(files['Metadata/model_settings.config']);
    expect(settings.match(/<plate>/g)).toHaveLength(1);
    expect(settings).toContain('key="extruder" value="1"');
    expect(settings).toContain('key="extruder" value="3"');
    expect(settings).not.toContain('<assemble_item');
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('BambuStudio:3mfVersion');
    expect(model.match(/<component /g)).toHaveLength(2);
    expect(model.match(/<item /g)).toHaveLength(2);
  });

  it('guards open meshes and Shapeways service limits', () => {
    expect(() =>
      validateWatertight({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }, 'Open'),
    ).toThrow('not watertight');
    expect(() => validateShapewaysLimits(1_000_001)).toThrow('one-million-triangle');
    expect(() => validateShapewaysLimits(1, 64 * 1024 * 1024 + 1)).toThrow('64 MiB');
    expect(() =>
      buildExport(
        'shapeways-3mf',
        {
          ...asset,
          terrain: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
        },
        project,
      ),
    ).toThrow('not watertight');
  });
});

describe('Marketiger full-color exterior', () => {
  const painted = {
    ...asset,
    inserts: [],
    faceMaterials: new Uint8Array([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]),
  };
  it('exports exact faces, texture colors, mm bounds and cm3 volume without project data', () => {
    const result = buildExport('marketiger', painted, project);
    expect(result.printModel!.dimensionsMm).toEqual([2, 2, 2]);
    expect(result.printModel!.volumeCm3).toBeCloseTo(0.008, 10);
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'colors.png',
      'model.mtl',
      'model.obj',
    ]);
    const png = files['colors.png'];
    const length = new DataView(png.buffer, png.byteOffset).getUint32(33);
    expect(Array.from(unzlibSync(png.slice(41, 41 + length)).slice(0, 5))).toEqual([
      0, 0x11, 0x22, 0x33, 255,
    ]);
    const obj = strFromU8(files['model.obj']);
    expect(obj.match(/^f /gm)).toHaveLength(12);
    expect(obj.match(/^o /gm)).toHaveLength(1);
    expect(obj).toContain('usemtl color_1\nf 1/2 4/2 3/2');
    // White Kd avoids multiplying texture RGB by itself.
    expect(strFromU8(files['model.mtl'])).toContain('# sRGB #112233\nKd 1 1 1');
    expect(buildExport('marketiger', painted, project).bytes).toEqual(result.bytes);
    expect(
      buildExport('marketiger', painted, {
        ...project,
        materials: project.materials!.map(m => ({ ...m, extruder: 1 })),
      }).bytes,
    ).toEqual(result.bytes);
  });
  it('rejects separate parts, open meshes, and invalid face colors', () => {
    expect(() => buildExport('marketiger', asset, project)).toThrow('Print together');
    expect(() =>
      buildExport(
        'marketiger',
        { ...painted, faceMaterials: new Uint8Array(12).fill(255) },
        project,
      ),
    ).toThrow('Unknown surface color');
    expect(() =>
      buildExport(
        'marketiger',
        {
          ...painted,
          terrain: { ...box(), indices: box().indices.slice(3) },
          faceMaterials: new Uint8Array(11),
        },
        project,
      ),
    ).toThrow('watertight');
  });
});

import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bambuProcessSettings, buildThreeMf } from '../src/three-mf';
import { defaults, type Asset, type Mesh, type Project } from '../src/types';
import { surfaceMaterials } from '../src/painted-surface';

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
  materials: [
    { id: 'terrain', name: 'Terrain', color: '#8baa73', extruder: 1 },
    { id: 'water', name: 'Water', color: '#0055ff', extruder: 3 },
    { id: 'ski_run', name: 'Ski runs', color: '#ffffff', extruder: 4 },
  ],
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
      mesh: box(25, 25, 0.1),
      origin: [20, 10, 5],
      insert_depth_mm: 1,
    },
  ],
  validation: { watertight: true, triangles: 12, pieces: 2, removed_terrain_islands: 0 },
  revision: 1,
};

describe('3MF export', () => {
  it.each(['bambu', 'prusa', 'portable'] as const)('preserves face painting in %s', kind => {
    const faceMaterials = new Uint8Array(12);
    faceMaterials[2] = surfaceMaterials.indexOf('water');
    faceMaterials[3] = surfaceMaterials.indexOf('ski_run');
    const painted = { ...asset, inserts: [], faceMaterials };
    const files = unzipSync(
      buildThreeMf(
        painted,
        {
          ...project,
          settings: { ...project.settings, manufacturing_mode: 'multicolor' },
        },
        kind,
      ),
    );
    const model = strFromU8(
      files[kind === 'bambu' ? '3D/Objects/object_1.model' : '3D/3dmodel.model'],
    );
    expect(model.match(/<mesh>/g)).toHaveLength(1);
    if (kind === 'portable') {
      expect(model).toMatch(/<triangle[^>]*p1="4" p2="4" p3="4"/);
      expect(model).toMatch(/<triangle[^>]*p1="6" p2="6" p3="6"/);
    } else {
      const attribute = kind === 'bambu' ? 'paint_color' : 'slic3rpe:mmu_segmentation';
      expect(model).toContain(`${attribute}="0C"`);
      expect(model).toContain(`${attribute}="1C"`);
      expect(model.split(`${attribute}="4"`)).toHaveLength(11);
    }
    if (kind === 'bambu') {
      const resourceIds = [...model.matchAll(/<(?:object|basematerials) id="(\d+)"/g)].map(
        match => match[1],
      );
      expect(new Set(resourceIds).size).toBe(resourceIds.length);
      const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
      expect(settings.filament_colour).toEqual(['#8BAA73', '#FFFFFF', '#0055FF', '#FFFFFF']);
    }
    if (kind === 'prusa')
      expect(strFromU8(files['Metadata/Slic3r_PE.config'])).toContain(
        '; filament_colour = #8BAA73;#FFFFFF;#0055FF;#FFFFFF',
      );
  });

  it('exports the resolved physical slot color for conflicting class colors', () => {
    const faceMaterials = new Uint8Array(12).fill(surfaceMaterials.indexOf('water'));
    const conflicted = {
      ...project,
      materials: [{ id: 'water' as const, name: 'Water', color: '#0000ff', extruder: 2 }],
    };
    const files = unzipSync(
      buildThreeMf({ ...asset, inserts: [], faceMaterials }, conflicted, 'bambu'),
    );
    expect(
      JSON.parse(strFromU8(files['Metadata/project_settings.config'])).filament_colour[1],
    ).toBe('#E78A43');
    expect(conflicted.materials[0].color).toBe('#0000ff');
  });

  it('rejects incomplete painted face assignments', () => {
    expect(() =>
      buildThreeMf({ ...asset, inserts: [], faceMaterials: new Uint8Array(1) }, project, 'bambu'),
    ).toThrow();
  });

  it('creates a portable assembled package with standard 3MF parts', () => {
    const files = unzipSync(
      buildThreeMf(
        asset,
        { ...project, settings: { ...project.settings, manufacturing_mode: 'multicolor' } },
        'portable',
      ),
    );
    expect(files['[Content_Types].xml']).toBeDefined();
    expect(files['_rels/.rels']).toBeDefined();
    expect(files['3D/3dmodel.model']).toBeDefined();
    expect(files['Metadata/project_settings.config']).toBeUndefined();
    expect(JSON.parse(strFromU8(files['Metadata/project.contour.json'])).name).toBe(project.name);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<object /g)).toHaveLength(3);
    expect(model).toContain('displaycolor="#0055FFFF"');
    expect(model).toMatch(/object id="2"[^>]*pindex="4"/);
    expect(model).toMatch(/object id="3"[^>]*pindex="6"/);
    expect(model.match(/<base /g)).toHaveLength(8);
    expect(model.match(/<item /g)).toHaveLength(3);
    expect(model).toContain('10.000000 20.000000 5.000000');
    expect(model).toContain('lake &amp; one');
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.format).toBe('portable');
    expect(manifest.plates).toHaveLength(1);
  });
  it('packs separate parts together with sparse process overrides and matching profile order', () => {
    const files = unzipSync(buildThreeMf(asset, project, 'bambu'));
    const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(settings).toMatchObject({
      ...bambuProcessSettings(project),
      brim_width: '3',
      print_sequence: 'by layer',
      printer_settings_id: 'Bambu Lab P1S 0.4 nozzle',
    });
    expect(settings.machine_start_gcode).toBeUndefined();
    expect(settings.nozzle_temperature).toBeUndefined();
    // Bambu reads the palette before applying defaults. Missing it crashes the
    // native project loader; sparse extruder slots still need palette entries.
    expect(settings.filament_colour).toEqual(['#8BAA73', '#E78A43', '#0055FF', '#FFFFFF']);
    expect(settings.filament_settings_id).toHaveLength(4);
    expect(settings.inherits_group).toEqual([
      settings.print_settings_id,
      ...settings.filament_settings_id,
      settings.printer_settings_id,
    ]);
    expect(settings.different_settings_to_system).toHaveLength(6);
    expect(settings.different_settings_to_system[0].split(';')).toEqual(
      expect.arrayContaining([
        'print_sequence',
        'brim_width',
        'layer_height',
        'enable_prime_tower',
      ]),
    );
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.plates).toHaveLength(1);
    expect(manifest.plates[0].objects).toEqual(['ski run', 'lake & one', 'Terrain']);
    expect(manifest.plates[0].print_sequence).toBe('by object');
    expect(strFromU8(files['Metadata/model_settings.config'])).toContain(
      'key="print_sequence" value="by object"',
    );
    const root = strFromU8(files['3D/3dmodel.model']);
    expect(root).toContain('BambuStudio-2.0.0');
    expect(root.match(/<item /g)).toHaveLength(3);
    const profiles = strFromU8(files['Metadata/layer_heights_profile.txt']).trim().split('\n');
    expect(profiles).toHaveLength(3);
    for (let i = 0; i < profiles.length; i++) {
      expect(profiles[i]).toMatch(new RegExp(`^object_id=${i + 1}\\|`));
      const model = strFromU8(files[`3D/Objects/object_${i + 1}.model`]);
      const heights = [...model.matchAll(/<vertex[^>]*z="([^"]+)"/g)].map(m => Number(m[1]));
      const values = profiles[i].split('|')[1].split(';').map(Number);
      expect(values.at(-2)).toBeCloseTo(Math.max(...heights) - Math.min(...heights));
    }
  });

  it.each(['p1s', 'x1c', 'a1', 'a1-mini'] as const)(
    'keeps low coupons on one %s plate',
    printer => {
      const coupon = {
        ...asset,
        terrain: box(100, 38, 3.2),
        inserts: Array.from({ length: 4 }, (_, i) => ({
          ...asset.inserts[0],
          id: `insert-${i}`,
          mesh: box(14, 12, 2),
        })),
      };
      const files = unzipSync(
        buildThreeMf(coupon, project, 'bambu', undefined, {
          sequentialSinglePlate: true,
          bambuPrinter: printer,
        }),
      );
      expect(strFromU8(files['Metadata/model_settings.config']).match(/<plate>/g)).toHaveLength(1);
      expect(JSON.parse(strFromU8(files['Metadata/project_settings.config'])).print_sequence).toBe(
        'by layer',
      );
      expect(strFromU8(files['Metadata/model_settings.config'])).toContain(
        'key="print_sequence" value="by object"',
      );
    },
  );

  it('uses native plate strides, keeps tall objects last, and never overlaps clearance envelopes', () => {
    const many = {
      ...asset,
      terrain: box(80, 70, 100),
      inserts: Array.from({ length: 12 }, (_, i) => ({
        ...asset.inserts[0],
        id: `part-${i}`,
        mesh: box(40, 40, i < 2 ? 60 : 10),
      })),
    };
    const files = unzipSync(buildThreeMf(many, project, 'bambu'));
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.plates.length).toBeGreaterThan(1);
    const cols = Math.ceil(Math.sqrt(manifest.plates.length));
    const items = [
      ...strFromU8(files['3D/3dmodel.model']).matchAll(
        /<item objectid="(\d+)"[^>]*transform="([^"]+)"/g,
      ),
    ];
    let index = 0;
    for (const plate of manifest.plates) {
      const gap = plate.print_sequence === 'by object' ? 73.999 : 7.999;
      const rectangles: { x: number; y: number; w: number; d: number; h: number }[] = [];
      for (const name of plate.objects) {
        const item = items[index++];
        const t = item[2].split(' ').map(Number);
        const x = t[9] - ((plate.plate - 1) % cols) * 307.2;
        const y = t[10] + Math.floor((plate.plate - 1) / cols) * 307.2;
        const mesh =
          name === 'Terrain' ? many.terrain : many.inserts.find(p => p.id === name)!.mesh;
        const w = Math.max(...mesh.positions.filter((_, i) => i % 3 === 0));
        const d = Math.max(...mesh.positions.filter((_, i) => i % 3 === 1));
        const h = Math.max(...mesh.positions.filter((_, i) => i % 3 === 2));
        expect(x).toBeGreaterThanOrEqual(3.999);
        expect(y).toBeGreaterThanOrEqual(3.999);
        expect(x + w).toBeLessThanOrEqual(252.001);
        expect(y + d).toBeLessThanOrEqual(252.001);
        expect(x >= 21.999 || y >= 31.999).toBe(true);
        for (const other of rectangles)
          expect(
            x + w + gap <= other.x ||
              other.x + other.w + gap <= x ||
              y + d + gap <= other.y ||
              other.y + other.d + gap <= y,
          ).toBe(true);
        rectangles.push({ x, y, w, d, h });
      }
      if (plate.print_sequence === 'by object')
        expect(rectangles.slice(0, -1).every(r => r.h <= 34)).toBe(true);
    }
    expect(() =>
      buildThreeMf(many, project, 'bambu', undefined, { sequentialSinglePlate: true }),
    ).toThrow('does not fit');
  });

  it('packs matching filaments densely by layer even with multiple tall objects', () => {
    const same = {
      ...project,
      materials: [
        { id: 'terrain' as const, name: 'Terrain', color: '#123456', extruder: 1 },
        { id: 'water' as const, name: 'Water', color: '#123456', extruder: 1 },
      ],
    };
    const dense = {
      ...asset,
      terrain: box(80, 80, 60),
      inserts: Array.from({ length: 3 }, (_, i) => ({
        ...asset.inserts[0],
        id: `same-${i}`,
        mesh: box(80, 80, 60),
      })),
    };
    const files = unzipSync(
      buildThreeMf(dense, same, 'bambu', undefined, { bambuPrinter: 'a1-mini' }),
    );
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.plates).toHaveLength(1);
    expect(manifest.plates[0].print_sequence).toBe('by layer');
    expect(strFromU8(files['Metadata/model_settings.config'])).toContain(
      'key="print_sequence" value="by layer"',
    );
    expect(
      JSON.parse(strFromU8(files['Metadata/project_settings.config'])).filament_colour,
    ).toEqual(['#123456']);
  });

  it('preserves the four default Post Canyon colors despite legacy shared feature slots', () => {
    const canyon = { ...project, materials: undefined };
    const pieces = {
      ...asset,
      inserts: (['trail', 'road', 'stream'] as const).map((cls, i) => ({
        ...asset.inserts[0],
        id: cls,
        class: cls,
        mesh: box(12, 12, 2 + i),
      })),
    };
    const files = unzipSync(buildThreeMf(pieces, canyon, 'bambu'));
    const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(settings.filament_colour).toEqual(['#8BAA73', '#E78A43', '#C2B17A', '#609CA7']);
    expect(settings.filament_settings_id).toHaveLength(4);
    const modelSettings = strFromU8(files['Metadata/model_settings.config']);
    for (const slot of [1, 2, 3, 4])
      expect(modelSettings).toContain(`key="extruder" value="${slot}"`);
    expect(canyon.materials).toBeUndefined();
  });

  it('rejects oversized models for the selected printer without scaling geometry', () => {
    expect(() =>
      buildThreeMf({ ...asset, terrain: box(200, 100, 5) }, project, 'bambu', undefined, {
        bambuPrinter: 'a1-mini',
      }),
    ).toThrow('does not fit');
  });
  it('rejects invalid triangle references before creating an archive', () => {
    const broken: Asset = {
      ...asset,
      terrain: { ...asset.terrain, indices: [0, 1, 999] },
    };
    expect(() => buildThreeMf(broken, project, 'portable')).toThrow('out-of-range triangle index');
  });
});

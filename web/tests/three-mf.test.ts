import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bambuProcessSettings, buildThreeMf } from '../src/three-mf';
import { defaults, type Asset, type Mesh, type Project } from '../src/types';
import { surfaceMaterials } from '../src/painted-surface';
import { bambuPrinter } from '../src/bambu-printers';
import { prusaPrinter, prusaProfile } from '../src/prusa-printers';
import { orcaPrinters, orcaProfile } from '../src/orca-printers';

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
  it.each(Object.keys(orcaPrinters) as Array<keyof typeof orcaPrinters>)(
    'writes an Orca %s project with complete native settings and sequential plates',
    printer => {
      const files = unzipSync(
        buildThreeMf(asset, project, 'orca', undefined, { orcaPrinter: printer }),
      );
      expect(strFromU8(files['3D/3dmodel.model'])).toContain(
        '<metadata name="Application">OrcaSlicer-2.4.2</metadata>',
      );
      const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
      const profile = orcaProfile(printer);
      expect(settings.printer_settings_id).toBe(profile.printer_settings_id);
      expect(settings.machine_start_gcode).toEqual(profile.machine.machine_start_gcode);
      expect(String(settings.machine_start_gcode)).toContain('G28');
      expect(
        [settings.nozzle_temperature_initial_layer].flat().every((n: string) => Number(n) > 150),
      ).toBe(true);
      expect(settings.print_sequence).toBe('by object');
      expect(settings.curr_bed_type).toBe('Textured PEI Plate');
      expect(settings.filament_ids).toHaveLength(settings.filament_colour.length);
      expect(settings.wall_loops).toBe('3');
      expect(settings.sparse_infill_density).toBe('5%');
      expect(settings.initial_layer_line_width).toBe('0.45');
      expect(settings.enable_prime_tower).toBe('0');
      expect(settings.elefant_foot_compensation).toBe('0');
      const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
      expect(manifest).toMatchObject({ format: 'orca', printer, print_sequence: 'by object' });
      expect(manifest.plates.flatMap((p: any) => p.objects)).toHaveLength(3);
      expect(manifest.plates.every((p: any) => p.print_sequence === 'by object')).toBe(true);
      if (!orcaPrinters[printer].automatic) {
        expect(settings.filament_colour).toHaveLength(1);
        expect(manifest.plates).toHaveLength(3);
        expect(manifest.plates.map((p: any) => p.filament.extruder).sort()).toEqual([1, 3, 4]);
        expect(strFromU8(files['Metadata/model_settings.config'])).not.toMatch(
          /key="extruder" value="[2-9]"/,
        );
        expect(strFromU8(files['Metadata/print-instructions.txt'])).toContain('design slot 3');
      } else expect(settings.filament_colour).toHaveLength(4);
      expect(strFromU8(files['Metadata/layer_heights_profile.txt'])).toContain('object_id=3|');
    },
  );

  it('preserves native Orca painting and enables the prime tower for automatic color changes', () => {
    const painted = {
      ...asset,
      inserts: [],
      faceMaterials: new Uint8Array(12).fill(surfaceMaterials.indexOf('water')),
    };
    const together = {
      ...project,
      settings: { ...project.settings, manufacturing_mode: 'multicolor' as const },
    };
    const files = unzipSync(buildThreeMf(painted, together, 'orca'));
    expect(strFromU8(files['3D/Objects/object_1.model'])).toContain('paint_color=');
    const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(settings).toMatchObject({ print_sequence: 'by layer', enable_prime_tower: '1' });
    expect(settings).toMatchObject({ wipe_tower_type: 'type1', wipe_tower_wall_type: 'rectangle' });
    expect(() =>
      buildThreeMf(painted, together, 'orca', undefined, { orcaPrinter: 'mk4s' }),
    ).toThrow(/automatic filament/);
    expect(() =>
      buildThreeMf(asset, project, 'orca', undefined, {
        orcaPrinter: 'core-one',
        orcaMaterialMode: 'automatic',
      }),
    ).toThrow(/PrusaSlicer for MMU3/);
  });

  it('supports manual Bambu plates and rejects unsupported Orca nozzle and AMS slot selections', () => {
    const files = unzipSync(
      buildThreeMf(asset, project, 'orca', undefined, { orcaMaterialMode: 'manual' }),
    );
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.plates).toHaveLength(3);
    expect(() => orcaProfile('p1s', 0.25)).toThrow(/No stock OrcaSlicer/);
    expect(() => orcaProfile('mk4s', 0.4, 'invalid' as any)).toThrow(/nozzle type/);
    expect(() => orcaProfile('invalid' as any)).toThrow(/supported OrcaSlicer printer/);
    const tooMany = {
      ...project,
      materials: project.materials!.map(g => (g.id === 'water' ? { ...g, extruder: 5 } : g)),
    };
    expect(() => buildThreeMf(asset, tooMany, 'orca')).toThrow(/four AMS/);
  });
  it.each([
    ['p1s', 256, [17, 0, 241, 16]],
    ['x1c', 256, [17, 0, 241, 16]],
    ['a1', 256, [87, -2, 169, 1]],
    ['a1-mini', 180, [67, -5, 116, 1]],
  ] as const)(
    'keeps every %s plate and brim clear of the stock purge path',
    (printer, bed, purge) => {
      const many = {
        ...asset,
        terrain: box(80, 80, 10),
        inserts: Array.from({ length: 8 }, (_, i) => ({
          ...asset.inserts[0],
          id: `part-${i}`,
          mesh: box(80, 80, 10),
        })),
      };
      for (const nozzle of [0.2, 0.4, 0.6, 0.8]) {
        const files = unzipSync(
          buildThreeMf(
            many,
            { ...project, settings: { ...project.settings, nozzle_diameter_mm: nozzle } },
            'bambu',
            undefined,
            { bambuPrinter: printer },
          ),
        );
        const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
        expect(manifest.plates.length).toBeGreaterThan(1);
        const columns = Math.ceil(Math.sqrt(manifest.plates.length));
        const items = [
          ...strFromU8(files['3D/3dmodel.model']).matchAll(
            /<item objectid="(\d+)"[^>]*transform="([^"]+)"/g,
          ),
        ];
        let index = 0;
        for (const plate of manifest.plates)
          for (const _name of plate.objects) {
            const t = items[index++][2].split(' ').map(Number);
            const x = t[9] - ((plate.plate - 1) % columns) * bed * 1.2;
            const y = t[10] + Math.floor((plate.plate - 1) / columns) * bed * 1.2;
            // Independent expected path bounds, plus the actual exported 3 mm brim.
            expect(
              x + 83 <= purge[0] || x - 3 >= purge[2] || y + 83 <= purge[1] || y - 3 >= purge[3],
            ).toBe(true);
            expect(x).toBeGreaterThanOrEqual(3.999);
            expect(y).toBeGreaterThanOrEqual(3.999);
            expect(x + 80).toBeLessThanOrEqual(bed - 3.999);
            expect(y + 80).toBeLessThanOrEqual(bed - 3.999);
          }
        expect(index).toBe(9);
      }
    },
  );
  it('rejects a full-depth P1S part that only fits by covering the purge line', () => {
    expect(() =>
      buildThreeMf({ ...asset, terrain: box(220, 240, 5), inserts: [] }, project, 'bambu'),
    ).toThrow('purge-line');
  });
  it.each(['separate', 'multicolor'] as const)(
    'writes native Prusa %s volume assignments',
    mode => {
      const files = unzipSync(
        buildThreeMf(
          asset,
          {
            ...project,
            settings: { ...project.settings, manufacturing_mode: mode },
          },
          'prusa',
          undefined,
          { prusaMaterialMode: 'mmu3' },
        ),
      );
      const config = strFromU8(files['Metadata/Slic3r_PE.config']);
      expect(config).toContain('; filament_colour = #8BAA73;#E78A43;#0055FF;#FFFFFF');
      const model = strFromU8(files['Metadata/Slic3r_PE_model.config']);
      expect(model.match(/<object /g)).toHaveLength(mode === 'separate' ? 3 : 1);
      for (const [i, slot] of [1, 3, 4].entries()) {
        const first = mode === 'separate' ? 0 : i * 12;
        expect(model).toContain(`<volume firstid="${first}" lastid="${first + 11}">`);
        expect(model).toContain(`key="extruder" value="${slot}"`);
      }
      expect(model).toContain('lake &amp; one');
      expect(strFromU8(files['3D/3dmodel.model'])).toContain('PrusaSlicer-2.9.0');
    },
  );

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
        undefined,
        { prusaMaterialMode: 'mmu3' },
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
      expect(settings.print_sequence).toBe('by layer');
      const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
      expect(manifest.print_sequence).toBe('by layer');
      expect(manifest.plates[0].print_sequence).toBe('by layer');
      expect(strFromU8(files['Metadata/model_settings.config'])).toContain(
        'key="print_sequence" value="by layer"',
      );
    }
    if (kind === 'prusa')
      expect(strFromU8(files['Metadata/Slic3r_PE.config'])).toContain(
        '; filament_colour = #8BAA73;#FFFFFF;#0055FF;#FFFFFF;#FFFFFF',
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
      print_sequence: 'by object',
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
    expect(manifest.print_sequence).toBe('by object');
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
        'by object',
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
      expect(plate.print_sequence).toBe('by object');
      const gap = 73.999;
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
      expect(rectangles.slice(0, -1).every(r => r.h <= 34)).toBe(true);
    }
    expect(() =>
      buildThreeMf(many, project, 'bambu', undefined, { sequentialSinglePlate: true }),
    ).toThrow('does not fit');
  });

  it.each(['p1s', 'x1c', 'a1', 'a1-mini'] as const)(
    'uses sequential clearance for matching filaments on %s, including low-only plates',
    printerId => {
      const printer = bambuPrinter(printerId);
      const same = {
        ...project,
        materials: project.materials!.map(group => ({ ...group, color: '#123456', extruder: 1 })),
      };
      for (const height of [2, 5]) {
        const pieces = {
          ...asset,
          terrain: box(40, 40, height),
          inserts: asset.inserts.map(piece => ({ ...piece, mesh: box(40, 40, 2) })),
        };
        const files = unzipSync(
          buildThreeMf(pieces, same, 'bambu', undefined, { bambuPrinter: printerId }),
        );
        const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
        expect(settings.print_sequence).toBe('by object');
        expect(settings.filament_colour).toEqual(['#123456']);
        const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
        expect(manifest.print_sequence).toBe('by object');
        expect(manifest.plates).toHaveLength(1);
        expect(manifest.plates[0].print_sequence).toBe('by object');
        expect(strFromU8(files['Metadata/model_settings.config'])).toContain(
          'key="print_sequence" value="by object"',
        );
        const positions = [
          ...strFromU8(files['3D/3dmodel.model']).matchAll(/<item [^>]*transform="([^"]+)"/g),
        ].map(match => match[1].split(' ').map(Number).slice(9, 11));
        expect(positions).toHaveLength(3);
        const gap = (height === 2 ? 4 : printer.clearanceMm) + 6;
        for (const [i, [x, y]] of positions.entries())
          for (const [otherX, otherY] of positions.slice(i + 1))
            expect(
              Math.abs(x - otherX) >= 40 + gap - 0.001 || Math.abs(y - otherY) >= 40 + gap - 0.001,
            ).toBe(true);
      }
    },
  );

  it('separates matching-filament tall objects onto sequential plates', () => {
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
    expect(manifest.plates).toHaveLength(4);
    for (const plate of manifest.plates) {
      expect(plate.print_sequence).toBe('by object');
      expect(plate.objects).toHaveLength(1);
    }
    expect(
      strFromU8(files['Metadata/model_settings.config']).match(
        /key="print_sequence" value="by object"/g,
      ),
    ).toHaveLength(4);
    expect(() =>
      buildThreeMf(dense, same, 'bambu', undefined, {
        bambuPrinter: 'a1-mini',
        sequentialSinglePlate: true,
      }),
    ).toThrow('does not fit on one plate');
    expect(
      JSON.parse(strFromU8(files['Metadata/project_settings.config'])).filament_colour,
    ).toEqual(['#123456']);
  });

  it.each(['bambu', 'prusa'] as const)('preserves four Post Canyon colors in %s', kind => {
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
    const files = unzipSync(
      buildThreeMf(pieces, canyon, kind, undefined, { prusaMaterialMode: 'mmu3' }),
    );
    if (kind === 'prusa') {
      const config = strFromU8(files['Metadata/Slic3r_PE.config']);
      expect(config).toContain('; filament_colour = #8BAA73;#E78A43;#C2B17A;#609CA7');
      expect(config).toContain('; nozzle_diameter = 0.4,0.4,0.4,0.4,0.4');
      const model = strFromU8(files['Metadata/Slic3r_PE_model.config']);
      expect(model.match(/<object /g)).toHaveLength(4);
      for (const slot of [1, 2, 3, 4])
        expect(model).toContain('key="extruder" value="' + slot + '"');
      expect(canyon.materials).toBeUndefined();
      return;
    }
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
  it.each(['mk4s', 'core-one'] as const)(
    'packs sequential %s MMU3 objects within native beds and retains the stock printer profile',
    printerId => {
      const printer = prusaPrinter(printerId);
      const many = {
        ...asset,
        terrain: box(100, 100, printer.rodHeightMm + 10),
        inserts: Array.from({ length: 4 }, (_, i) => ({
          ...asset.inserts[0],
          id: `prusa-${i}`,
          mesh: box(80, 80, i === 0 ? printer.rodHeightMm + 2 : 5),
        })),
      };
      const files = unzipSync(
        buildThreeMf(many, project, 'prusa', undefined, {
          prusaPrinter: printerId,
          prusaMaterialMode: 'mmu3',
        }),
      );
      const config = strFromU8(files['Metadata/Slic3r_PE.config']);
      expect(config).toContain('; complete_objects = 1');
      expect(config).toContain('; printer_settings_id = ' + printer.name + ' MMU3 HF0.4 nozzle');
      expect(config).toContain('; start_gcode = M17');
      expect(config).toContain('; filament_settings_id = Prusament PLA');
      expect(config).toContain('; single_extruder_multi_material = 1');
      expect(config).toContain('; nozzle_diameter = 0.4,0.4,0.4,0.4,0.4');
      const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
      expect(manifest.printer).toBe(printerId);
      expect(manifest.bed_size_mm).toEqual(printer.bedMm);
      expect(manifest.plates.length).toBeGreaterThan(1);
      const transforms = [
        ...strFromU8(files['3D/3dmodel.model']).matchAll(/<item [^>]*transform="([^"]+)"/g),
      ].map(match => match[1].split(' ').map(Number));
      let index = 0;
      for (const plate of manifest.plates) {
        expect(plate.print_sequence).toBe('by object');
        const rectangles: { x: number; y: number; width: number; depth: number; height: number }[] =
          [];
        for (const name of plate.objects) {
          const t = transforms[index++];
          const piece =
            name === 'Terrain' ? many.terrain : many.inserts.find(p => p.id === name)!.mesh;
          const rectangle = {
            x: t[9] - (plate.plate - 1) * 300,
            y: t[10],
            width: Math.max(...Array.from(piece.positions).filter((_, i) => i % 3 === 0)),
            depth: Math.max(...Array.from(piece.positions).filter((_, i) => i % 3 === 1)),
            height: Math.max(...Array.from(piece.positions).filter((_, i) => i % 3 === 2)),
          };
          expect(rectangle.x).toBeGreaterThanOrEqual(4);
          expect(rectangle.y).toBeGreaterThanOrEqual(4);
          expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(printer.bedMm[0] - 4);
          expect(rectangle.y + rectangle.depth).toBeLessThanOrEqual(printer.bedMm[1] - 4);
          for (const other of rectangles) {
            const gap = printer.clearanceMm + 6;
            expect(
              rectangle.x + rectangle.width + gap <= other.x ||
                other.x + other.width + gap <= rectangle.x ||
                rectangle.y + rectangle.depth + gap <= other.y ||
                other.y + other.depth + gap <= rectangle.y,
            ).toBe(true);
          }
          rectangles.push(rectangle);
        }
        expect(rectangles.slice(0, -1).every(r => r.height <= printer.rodHeightMm)).toBe(true);
      }
      expect(index).toBe(5);
    },
  );

  it('puts manual-change Prusa colors on separate plates and maps their native parts to one tool', () => {
    const files = unzipSync(buildThreeMf(asset, project, 'prusa'));
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.material_mode).toBe('manual');
    expect(manifest.plates).toHaveLength(3);
    expect(new Set(manifest.plates.map((plate: any) => plate.filament.extruder))).toEqual(
      new Set([1, 3, 4]),
    );
    const config = strFromU8(files['Metadata/Slic3r_PE.config']);
    expect(config).toContain('; single_extruder_multi_material = 0');
    expect(config).toContain('; nozzle_diameter = 0.4\n');
    const model = strFromU8(files['Metadata/Slic3r_PE_model.config']);
    expect([...model.matchAll(/key="extruder" value="(\d+)"/g)].map(m => m[1])).toEqual([
      '1',
      '1',
      '1',
    ]);
    expect(JSON.parse(strFromU8(files['Metadata/project.contour.json'])).materials).toEqual(
      expect.arrayContaining(project.materials!),
    );
    expect(strFromU8(files['Metadata/print-instructions.txt'])).toContain('one filament');
  });

  it('rejects unsupported Prusa printer/nozzle, excess MMU slots, oversized parts, and a tenth bed', () => {
    expect(() => prusaPrinter('unknown' as never)).toThrow('supported Prusa');
    expect(() => prusaProfile('mk4s', 0.2)).toThrow('stock');
    expect(() => prusaProfile('mk4s', 0.6, 'mmu3', 'high-flow')).toThrow('stock');
    expect(prusaProfile('mk4s', 0.6, 'mmu3', 'standard').printer_variant).toBe('0.6');
    expect(() =>
      buildThreeMf(
        asset,
        {
          ...project,
          materials: project.materials!.map(m => ({ ...m, extruder: m.extruder + 5 })),
        },
        'prusa',
        undefined,
        { prusaMaterialMode: 'mmu3' },
      ),
    ).toThrow('five filament slots');
    expect(() => buildThreeMf({ ...asset, terrain: box(250, 200, 5) }, project, 'prusa')).toThrow(
      'does not fit',
    );
    expect(() =>
      buildThreeMf(
        {
          ...asset,
          inserts: Array.from({ length: 9 }, (_, i) => ({
            ...asset.inserts[0],
            id: `tall-${i}`,
            mesh: box(20, 20, 40),
          })),
        },
        project,
        'prusa',
      ),
    ).toThrow('9-plate limit');
    expect(() =>
      buildThreeMf(
        asset,
        { ...project, settings: { ...project.settings, manufacturing_mode: 'multicolor' } },
        'prusa',
        undefined,
        { prusaMaterialMode: 'manual' },
      ),
    ).toThrow('require MMU3');
  });
  it('rejects invalid triangle references before creating an archive', () => {
    const broken: Asset = {
      ...asset,
      terrain: { ...asset.terrain, indices: [0, 1, 999] },
    };
    expect(() => buildThreeMf(broken, project, 'portable')).toThrow('out-of-range triangle index');
  });
});

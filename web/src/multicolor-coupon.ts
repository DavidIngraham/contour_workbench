import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { compactManifoldMesh } from './manifold-adapter';
import { assemblePaintedSurface } from './painted-surface';
import { defaults, type Asset, type Piece, type Project } from './types';

/** A small, dimensioned three-filament coupon; the notch marks its front-left corner. */
export async function multicolorCoupon(
  M: ManifoldToplevel,
  nozzle: number,
  checkpoint: () => Promise<void> = async () => {},
) {
  if (!Number.isFinite(nozzle) || nozzle < 0.2 || nozzle > 1.2)
    throw new Error('Choose a nozzle diameter between 0.2 and 1.2 mm.');
  const owned: Manifold[] = [];
  const cube = (size: [number, number, number], origin: [number, number, number]) => {
    const raw = M.Manifold.cube(size);
    owned.push(raw);
    const placed = raw.translate(origin);
    owned.push(placed);
    return placed;
  };
  const pieces: Piece[] = [];
  const cutters: Manifold[] = [];
  const offsets = [-0.3, 0, 0.35];
  const widths = [0.75, 1, 1.5, 2].map(value => value * nozzle);
  try {
    const base = cube([60, 42, 2.4], [0, 0, 0]);
    cutters.push(cube([4, 4, 4], [-1, -1, 0]));
    for (const [row, offset] of offsets.entries()) {
      await checkpoint();
      for (let column = 0; column < 5; column++) {
        const patch = column === 4;
        const width = 8,
          depth = patch ? 6 : widths[column];
        const origin: [number, number, number] = [
          patch ? 48 : 3 + column * 11,
          9 + row * 12 - depth / 2,
          1.4,
        ];
        cutters.push(cube([width, depth, 3], origin));
        const body = cube([width, depth, 1 + offset], [0, 0, 0]);
        pieces.push({
          id: `row-${row + 1}-${column + 1}`,
          class: patch ? 'water' : 'trail',
          mesh: compactManifoldMesh(body.getMesh()),
          origin,
          insert_depth_mm: 1,
        });
      }
    }
    const cut = M.Manifold.union(cutters);
    owned.push(cut);
    const terrain = base.subtract(cut);
    owned.push(terrain);
    const painted = await assemblePaintedSurface(
      M,
      compactManifoldMesh(terrain.getMesh()),
      pieces,
      checkpoint,
    );
    const project: Project = {
      schema_version: 2,
      name: 'Multicolor print test',
      grid: { bounds: [0, 0, 0.001, 0.001], width: 2, height: 2, elevations: [0, 0, 0, 0] },
      source: {
        product: 'calibration',
        name: 'Multicolor coupon',
        attribution: 'Contour Workbench',
        retrieved: 'generated',
      },
      features: [],
      settings: {
        ...defaults,
        manufacturing_mode: 'multicolor',
        nozzle_diameter_mm: nozzle,
        base_height_mm: 2.4,
        max_print_size_mm: [60, 42],
      },
      materials: [
        { id: 'terrain', name: 'Base', color: '#8baa73', extruder: 1 },
        { id: 'trail', name: 'Lines', color: '#e78a43', extruder: 2 },
        { id: 'water', name: 'Patches', color: '#4f9fca', extruder: 3 },
      ],
    };
    const asset: Asset = {
      terrain: painted.mesh,
      faceMaterials: painted.faceMaterials,
      inserts: [],
      revision: 0,
      validation: {
        watertight: true,
        triangles: painted.mesh.indices.length / 3,
        pieces: 0,
        removed_terrain_islands: 0,
      },
    };
    return {
      project,
      asset,
      legend: {
        size_mm: [60, 42],
        base_height_mm: 2.4,
        nozzle_mm: nozzle,
        rows_front_to_back_offset_mm: offsets,
        line_widths_left_to_right_mm: widths,
        patch_size_mm: [8, 6],
        slots: { base: 1, lines: 2, patches: 3 },
      },
    };
  } finally {
    owned.reverse().forEach(solid => solid.delete());
  }
}

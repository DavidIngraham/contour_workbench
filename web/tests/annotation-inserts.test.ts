import { beforeAll, expect, it } from 'vitest';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import { annotationGeometry, type Annotation } from '../src/annotations';
import {
  buildAnnotationInsert,
  assertAnnotationClearance,
  flatAnnotationSolid,
  assertFaceAnnotationBacking,
} from '../src/annotation-inserts';
import { assembledPieceMesh } from '../src/piece-placement';
import { fitProfile } from '../src/insert-fit';
import { compactManifoldMesh, solidFromMesh, validateMesh } from '../src/manifold-adapter';
import { assemblePaintedSurface, surfaceMaterials } from '../src/painted-surface';
import { defaults, projectMaterialGroups, type Grid, type Layout } from '../src/types';
import type { Project, Asset } from '../src/types';
import { buildExport } from '../src/export-formats';
import { strFromU8, unzipSync } from 'fflate';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await Module();
  M.setup();
});
const grid: Grid = { bounds: [0, 0, 1, 1], width: 2, height: 2, elevations: [0, 0, 0, 0] };
const layout: Layout = {
  bounds: grid.bounds,
  width: 40,
  depth: 40,
  base_height: 5,
  minimum: 0,
  scale: 1,
  rotated: false,
  height_factor: 1,
};
const annotation: Annotation = {
  id: 'letters',
  name: 'Two letters',
  kind: 'text',
  text: 'II',
  threshold: 128,
  invert: false,
  mask: [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1],
  pixels_w: 6,
  pixels_h: 2,
  enabled: true,
  placement: 'terrain',
  treatment: 'raised',
  as_insert: true,
  insert_depth_mm: 2,
  x_mm: 20,
  y_mm: 20,
  width_mm: 12,
  height_mm: 4,
  angle_deg: 0,
  depth_mm: 0.6,
  porch_depth_mm: 16,
  porch_align: 'base',
};
const settings = { ...defaults, insert_elephant_foot_relief_mm: 0, insert_draft_angle_deg: 0 };
const noTaper = (solid: import('manifold-3d').Manifold, depth: number) => ({
  solid,
  profile: fitProfile(settings, 'annotations', depth),
});
it('returns only failed component meshes and preserves borrowed terrain on a narrow-insert failure', async () => {
  const a = { ...annotation, width_mm: 0.6, height_mm: 3 };
  const base = M.Manifold.cube([40, 40, 5]);
  try {
    const result = buildAnnotationInsert(
      M,
      a,
      annotationGeometry(a, grid, settings, layout),
      settings,
      base,
      async () => {},
      noTaper,
    );
    await expect(result).rejects.toMatchObject({
      annotationDiagnostic: {
        annotationId: a.id,
        meshes: expect.arrayContaining([
          expect.objectContaining({ positions: expect.anything(), indices: expect.anything() }),
        ]),
      },
    });
    expect(base.volume()).toBeCloseTo(8000);
    expect(base.status()).toBe('NoError');
  } finally {
    base.delete();
  }
});

for (const placement of ['bottom', 'side'] as const) {
  it(`prints ${placement} inserts flat and restores assembly orientation in geometry and exports`, async () => {
    const a: Annotation = {
      ...annotation,
      placement,
      side_index: 0,
      y_mm: placement === 'side' ? 0 : 20,
      z_mm: 2.5,
      height_mm: 3,
    };
    const base = M.Manifold.cube([40, 40, 5]);
    const geometry = annotationGeometry(a, grid, settings, layout);
    const result = await buildAnnotationInsert(
      M,
      a,
      geometry,
      settings,
      base,
      async () => {},
      noTaper,
    );
    const project: Project = {
      schema_version: 2,
      name: 'Face inserts',
      grid,
      annotations: [a],
      settings,
      features: [],
      source: { product: 'test', name: 'Test', attribution: 'Test', retrieved: 'today' },
    };
    const asset: Asset = {
      terrain: compactManifoldMesh(result.terrain.getMesh()),
      inserts: result.pieces,
      revision: 1,
      validation: {
        watertight: true,
        pieces: result.pieces.length,
        triangles: result.terrain.numTri(),
        removed_terrain_islands: 0,
      },
    };
    try {
      expect(result.pieces).toHaveLength(2);
      for (const piece of result.pieces) {
        validateMesh(piece.mesh);
        const print = solidFromMesh(M, piece.mesh),
          rotated = solidFromMesh(M, assembledPieceMesh(piece));
        const assembled = rotated.translate(piece.origin),
          collision = assembled.intersect(result.terrain);
        try {
          expect(print.boundingBox().min[2]).toBeCloseTo(0);
          expect(print.boundingBox().max[2]).toBeCloseTo(2.6, 5);
          expect(collision.volume()).toBeCloseTo(0, 5);
          expect(assembled.boundingBox().min[placement === 'bottom' ? 2 : 1]).toBeCloseTo(-0.6, 5);
        } finally {
          collision.delete();
          assembled.delete();
          rotated.delete();
          print.delete();
        }
      }
      for (const format of ['stl', 'portable', 'bambu', 'prusa', 'orca'] as const) {
        const files = unzipSync(buildExport(format, asset, project).bytes);
        const metadata = JSON.parse(
          strFromU8(
            files[format === 'stl' ? 'insert_manifest.json' : 'Metadata/contour_workbench.json'],
          ),
        );
        const pieces = metadata.pieces ?? metadata.inserts;
        expect(pieces[0].assembly_basis).toEqual(result.pieces[0].assembly_basis);
        expect(pieces[0].assembly_origin_mm).toEqual(result.pieces[0].origin);
        if (format === 'stl') {
          const data = strFromU8(files['inserts/' + result.pieces[0].id + '.stl']);
          const zs = [...data.matchAll(/vertex [\d.e+-]+ [\d.e+-]+ ([\d.e+-]+)/g)].map(match =>
            Number(match[1]),
          );
          expect(Math.min(...zs)).toBeCloseTo(0);
          expect(Math.max(...zs)).toBeCloseTo(2.6, 5);
        }
      }
      const combined = await assemblePaintedSurface(M, asset.terrain, result.pieces);
      validateMesh(combined.mesh);
      expect(new Set(combined.faceMaterials)).toEqual(
        new Set([0, surfaceMaterials.indexOf('annotations')]),
      );
      expect(
        Math.min(
          ...Array.from(combined.mesh.positions).filter(
            (_, i) => i % 3 === (placement === 'bottom' ? 2 : 1),
          ),
        ),
      ).toBeCloseTo(-0.6, 5);
      const fullColor = unzipSync(buildExport('shapeways-color', asset, project).bytes);
      const obj = strFromU8(fullColor['model.obj']);
      const coordinates = [...obj.matchAll(/^v ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/gm)].map(match =>
        Number(match[placement === 'bottom' ? 3 : 2]),
      );
      expect(Math.min(...coordinates)).toBeCloseTo(-0.6, 5);
    } finally {
      result.terrain.delete();
      result.pocket.delete();
      base.delete();
    }
  });
}

it('keeps flat insert tops planar on the native triangulated surface', async () => {
  const a = { ...annotation, drape: false };
  const slope = { ...grid, elevations: [0, 4, 0, 4] };
  const base = M.Manifold.cube([40, 40, 5]);
  const terrain = base.warp(p => {
    if (p[2] > 0) p[2] += p[0] / 10;
  });
  const geometry = annotationGeometry(a, slope, settings, layout);
  const result = await buildAnnotationInsert(
    M,
    a,
    geometry,
    settings,
    terrain,
    async () => {},
    noTaper,
  );
  try {
    const tops = result.pieces.map(
      piece =>
        Math.max(...Array.from(piece.mesh.positions).filter((_, i) => i % 3 === 2)) +
        piece.origin[2],
    );
    tops.forEach(top => expect(top).toBeCloseTo(8.2, 3));
    expect(new Set(tops.map(top => top.toFixed(5))).size).toBe(1);
  } finally {
    result.terrain.delete();
    result.pocket.delete();
    terrain.delete();
    base.delete();
  }
});
it('makes flat raised tops and engraving floors from the native roof', () => {
  const base = M.Manifold.cube([40, 40, 5]);
  const terrain = base.warp(p => {
    if (p[2] > 0) p[2] += p[0] / 10;
  });
  try {
    for (const treatment of ['raised', 'engraved'] as const) {
      const a = { ...annotation, as_insert: false, drape: false, treatment };
      const geometry = annotationGeometry(
        a,
        { ...grid, elevations: [0, 4, 0, 4] },
        settings,
        layout,
      );
      const parts = geometry.solids.map(mesh => solidFromMesh(M, mesh));
      const label = M.Manifold.union(parts);
      const flat = flatAnnotationSolid(a, geometry, label, terrain);
      try {
        validateMesh(compactManifoldMesh(flat.getMesh()));
        expect(
          treatment === 'raised' ? flat.boundingBox().max[2] : flat.boundingBox().min[2],
        ).toBeCloseTo(treatment === 'raised' ? 8.2 : 5.8, 3);
      } finally {
        flat.delete();
        label.delete();
        parts.forEach(part => part.delete());
      }
    }
  } finally {
    terrain.delete();
    base.delete();
  }
});
it('rejects a hidden gap in native side backing between preview samples', async () => {
  const a: Annotation = {
    ...annotation,
    placement: 'side',
    as_insert: false,
    y_mm: 0,
    z_mm: 2.5,
    height_mm: 3,
  };
  const geometry = annotationGeometry(a, grid, settings, layout);
  const base = M.Manifold.cube([40, 40, 5]);
  const gap = M.Manifold.cube([0.1, 3, 4]),
    placedGap = gap.translate([15.22, 0, 0.5]);
  const terrain = base.subtract(placedGap);
  const parts = geometry.solids.map(mesh => solidFromMesh(M, mesh)),
    label = M.Manifold.union(parts);
  try {
    expect(() => assertFaceAnnotationBacking(a, geometry, label, terrain)).toThrow('backing');
    const insert = { ...a, as_insert: true };
    await expect(
      buildAnnotationInsert(
        M,
        insert,
        annotationGeometry(insert, grid, settings, layout),
        settings,
        terrain,
        async () => {},
        noTaper,
      ),
    ).rejects.toThrow('solid base');
    expect(base.volume()).toBeCloseTo(8000);
  } finally {
    label.delete();
    parts.forEach(part => part.delete());
    terrain.delete();
    placedGap.delete();
    gap.delete();
    base.delete();
  }
});

it('releases transformed native solids when a face insert is cancelled', async () => {
  const a: Annotation = { ...annotation, placement: 'bottom' };
  const base = M.Manifold.cube([40, 40, 5]);
  let calls = 0;
  try {
    await expect(
      buildAnnotationInsert(
        M,
        a,
        annotationGeometry(a, grid, settings, layout),
        settings,
        base,
        async () => {
          if (++calls === 2) throw new Error('Cancelled');
        },
        noTaper,
      ),
    ).rejects.toThrow('Cancelled');
    expect(base.volume()).toBeCloseTo(8000);
  } finally {
    base.delete();
  }
});

it('cuts clearance pockets and exports disconnected letters as individually watertight flat-bottom parts', async () => {
  const base = M.Manifold.cube([40, 40, 5]);
  const geometry = annotationGeometry(annotation, grid, settings, layout);
  const result = await buildAnnotationInsert(
    M,
    annotation,
    geometry,
    settings,
    base,
    async () => {},
    noTaper,
  );
  try {
    expect(result.pieces).toHaveLength(2);
    validateMesh(compactManifoldMesh(result.terrain.getMesh()));
    expect(result.terrain.volume()).toBeLessThan(base.volume());
    for (const piece of result.pieces) {
      expect(piece.class).toBe('annotations');
      expect(piece.origin[2]).toBeCloseTo(3);
      expect(piece.insert_depth_mm).toBeCloseTo(2);
      validateMesh(piece.mesh);
      const solid = solidFromMesh(M, piece.mesh);
      const global = solid.translate(piece.origin);
      const collision = global.intersect(result.terrain);
      try {
        expect(solid.boundingBox().min[2]).toBeCloseTo(0, 6);
        expect(collision.volume()).toBeCloseTo(0, 6);
        expect(solid.boundingBox().max[2]).toBeCloseTo(2.6, 5);
      } finally {
        collision.delete();
        global.delete();
        solid.delete();
      }
    }
    const bounds = result.pocket.boundingBox();
    expect(bounds.min[0]).toBeLessThan(14);
    expect(bounds.max[0]).toBeGreaterThan(26);
    expect(base.volume()).toBeCloseTo(8000);
  } finally {
    result.terrain.delete();
    result.pocket.delete();
    base.delete();
  }
});

it('keeps a single flat floor on sloping terrain and allows flush inlays', () => {
  const sloping = { ...grid, elevations: [0, 4, 1, 6] };
  const geometry = annotationGeometry({ ...annotation, depth_mm: 0 }, sloping, settings, layout);
  for (const solid of geometry.solids)
    for (let index = 14; index < 24; index += 3)
      expect(solid.positions[index]).toBe(geometry.floorMm);
  expect(geometry.insertDepthMm).toBeCloseTo(2);
  expect(geometry.floorMm).toBeGreaterThan(3);
});

it('fits printed tops to native terrain triangles rather than the bilinear preview approximation', async () => {
  const source = M.Manifold.cube([40, 40, 5]);
  const base = source.warp(point => {
    if (point[2] > 0) point[2] += point[0] * point[1] * 0.01;
  });
  source.delete();
  const mesh = compactManifoldMesh(base.getMesh());
  const topAt = (x: number, y: number) => {
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const [a, b, c] = Array.from(mesh.indices.slice(index, index + 3), vertex =>
        Array.from(mesh.positions.slice(vertex * 3, vertex * 3 + 3)),
      );
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-8 || [a, b, c].some(point => point[2] === 0)) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      if (Math.min(u, v, 1 - u - v) >= -1e-5) return u * a[2] + v * b[2] + (1 - u - v) * c[2];
    }
    throw new Error('Point outside native terrain');
  };
  const label = { ...annotation, insert_depth_mm: 4 };
  const geometry = annotationGeometry(
    label,
    { ...grid, elevations: [0, 0, 0, 16] },
    settings,
    layout,
  );
  const result = await buildAnnotationInsert(
    M,
    label,
    geometry,
    settings,
    base,
    async () => {},
    noTaper,
  );
  try {
    for (const piece of result.pieces)
      for (let index = 0; index < piece.mesh.positions.length; index += 3) {
        const [x, y, z] = Array.from(piece.mesh.positions.slice(index, index + 3));
        if (z > 0.0001)
          expect(z + piece.origin[2]).toBeCloseTo(
            topAt(x + piece.origin[0], y + piece.origin[1]) + label.depth_mm,
            4,
          );
      }
  } finally {
    result.terrain.delete();
    result.pocket.delete();
    base.delete();
  }
});

it('keeps artwork holes open and fuses annotation color without internal shells in print-together mode', async () => {
  const label: Annotation = {
    ...annotation,
    pixels_w: 7,
    pixels_h: 7,
    width_mm: 14,
    height_mm: 14,
    mask: ['1111111', '1111111', '1100011', '1100011', '1100011', '1111111', '1111111']
      .join('')
      .split('')
      .map(Number),
  };
  const together = { ...settings, manufacturing_mode: 'multicolor' as const };
  const base = M.Manifold.cube([40, 40, 5]);
  const result = await buildAnnotationInsert(
    M,
    label,
    annotationGeometry(label, grid, together, layout),
    together,
    base,
    async () => {},
    noTaper,
  );
  try {
    expect(result.pieces).toHaveLength(1);
    const merged = await assemblePaintedSurface(
      M,
      compactManifoldMesh(result.terrain.getMesh()),
      result.pieces,
    );
    const solid = solidFromMesh(M, merged.mesh);
    const components = solid.decompose();
    try {
      expect(components).toHaveLength(1);
      expect(merged.faceMaterials).toContain(surfaceMaterials.indexOf('annotations'));
      const top = solid.slice(5.3);
      try {
        expect(top.toPolygons()).toHaveLength(2);
      } finally {
        top.delete();
      }
    } finally {
      components.forEach(part => part.delete());
      solid.delete();
    }
  } finally {
    result.terrain.delete();
    result.pocket.delete();
    base.delete();
  }
});

it('rejects insufficient pocket support and unprintable strokes', async () => {
  const base = M.Manifold.cube([40, 40, 5]);
  try {
    const nearEdge = {
      ...annotation,
      x_mm: 1,
      width_mm: 1.8,
      mask: [1, 1, 1, 1],
      pixels_w: 2,
      pixels_h: 2,
    };
    await expect(
      buildAnnotationInsert(
        M,
        nearEdge,
        annotationGeometry(nearEdge, grid, settings, layout),
        settings,
        base,
        async () => {},
        noTaper,
      ),
    ).rejects.toThrow('clearance');
    const thin = { ...annotation, width_mm: 0.2, mask: [1], pixels_w: 1, pixels_h: 1 };
    await expect(
      buildAnnotationInsert(
        M,
        thin,
        annotationGeometry(thin, grid, settings, layout),
        settings,
        base,
        async () => {},
        noTaper,
      ),
    ).rejects.toThrow('too narrow');
    expect(() =>
      annotationGeometry(annotation, grid, settings, { ...layout, base_height: 0.5 }),
    ).toThrow('pocket depth');
    expect(() =>
      annotationGeometry(annotation, grid, settings, { ...layout, base_height: 0.6 }),
    ).not.toThrow();
  } finally {
    base.delete();
  }
});

it('honors cancellation after allocating a pocket and leaves the borrowed terrain usable', async () => {
  const base = M.Manifold.cube([40, 40, 5]);
  const geometry = annotationGeometry(annotation, grid, settings, layout);
  let checkpoints = 0;
  try {
    await expect(
      buildAnnotationInsert(
        M,
        annotation,
        geometry,
        settings,
        base,
        async () => {
          if (++checkpoints === 3) throw new Error('Canceled');
        },
        noTaper,
      ),
    ).rejects.toThrow('Canceled');
    expect(base.volume()).toBeCloseTo(8000);
    const result = await buildAnnotationInsert(
      M,
      annotation,
      geometry,
      settings,
      base,
      async () => {},
      noTaper,
    );
    result.terrain.delete();
    result.pocket.delete();
  } finally {
    base.delete();
  }
});

it('rejects assembly collisions and resolves annotation material without changing older defaults', () => {
  const part = M.Manifold.cube([4, 4, 4]);
  const far = part.translate([10, 0, 0]);
  try {
    expect(() => assertAnnotationClearance(part, part, 'Label')).toThrow('overlaps');
    expect(() => assertAnnotationClearance(part, far, 'Label')).not.toThrow();
    expect(projectMaterialGroups({}).some(group => group.id === 'annotations')).toBe(false);
    expect(
      projectMaterialGroups({ annotations: [annotation] }).find(
        group => group.id === 'annotations',
      ),
    ).toMatchObject({ color: '#dcc291', extruder: 3 });
  } finally {
    far.delete();
    part.delete();
  }
});

it('retains annotation parts, assembly positions, and materials across STL and slicer projects', async () => {
  const base = M.Manifold.cube([40, 40, 5]);
  const result = await buildAnnotationInsert(
    M,
    annotation,
    annotationGeometry(annotation, grid, settings, layout),
    settings,
    base,
    async () => {},
    noTaper,
  );
  const project: Project = {
    schema_version: 2,
    name: 'Annotation exports',
    grid,
    annotations: [annotation],
    features: [],
    source: { product: 'test', name: 'Test', retrieved: 'today', attribution: 'Test' },
    settings: { ...settings, base_height_mm: 5, max_print_size_mm: [40, 40] },
    materials: [{ id: 'annotations', name: 'Annotation inserts', color: '#12ABCD', extruder: 3 }],
  };
  const asset: Asset = {
    terrain: compactManifoldMesh(result.terrain.getMesh()),
    inserts: result.pieces,
    revision: 1,
    validation: {
      watertight: true,
      pieces: result.pieces.length,
      triangles: result.terrain.numTri(),
      removed_terrain_islands: 0,
    },
  };
  try {
    const stl = unzipSync(buildExport('stl', asset, project).bytes);
    expect(Object.keys(stl).filter(name => name.startsWith('inserts/'))).toHaveLength(2);
    const manifest = JSON.parse(strFromU8(stl['insert_manifest.json']));
    expect(manifest.pieces.map((piece: any) => piece.assembly_origin_mm)).toEqual(
      result.pieces.map(piece => piece.origin),
    );
    for (const format of ['portable', 'bambu', 'prusa', 'orca'] as const) {
      const files = unzipSync(buildExport(format, asset, project).bytes);
      const saved = JSON.parse(strFromU8(files['Metadata/project.contour.json']));
      expect(saved.annotations[0]).toMatchObject({ as_insert: true, insert_depth_mm: 2 });
      const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
      expect(manifest.inserts).toHaveLength(2);
      expect(manifest.inserts.every((piece: any) => piece.class === 'annotations')).toBe(true);
      expect(
        Object.entries(files).some(
          ([name, bytes]) => name.endsWith('.model') && strFromU8(bytes).includes('#12ABCDFF'),
        ),
      ).toBe(true);
    }
    const multicolor = await assemblePaintedSurface(M, asset.terrain, result.pieces);
    const colored: Asset = {
      ...asset,
      terrain: multicolor.mesh,
      faceMaterials: multicolor.faceMaterials,
      inserts: [],
    };
    const fullColor = unzipSync(
      buildExport('marketiger', colored, {
        ...project,
        settings: { ...settings, manufacturing_mode: 'multicolor' },
      }).bytes,
    );
    expect(strFromU8(fullColor['model.obj'])).toContain(
      `usemtl color_${surfaceMaterials.indexOf('annotations')}`,
    );
    expect(strFromU8(fullColor['model.mtl'])).toContain('# sRGB #12ABCD');
  } finally {
    result.terrain.delete();
    result.pocket.delete();
    base.delete();
  }
});

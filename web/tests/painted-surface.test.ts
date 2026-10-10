import { beforeAll, describe, expect, it } from 'vitest';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import {
  assemblePaintedSurface,
  paintedBuildInputs,
  removeNumericalShells,
  trianglePaintCode,
} from '../src/painted-surface';
import { combineMeshes, compactManifoldMesh, solidFromMesh } from '../src/manifold-adapter';
import { defaults, type Piece } from '../src/types';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await Module();
  M.setup();
});

describe('painted exterior', () => {
  it.each([-0.3, 0, 0.35])(
    'removes internal walls and preserves exact face boundaries at offset %s',
    async offset => {
      const base = M.Manifold.cube([20, 20, 3]);
      const cutterSource = M.Manifold.cube([4, 20, 3]);
      const cutter = cutterSource.translate([8, 0, 2]);
      cutterSource.delete();
      const cut = base.subtract(cutter);
      const part = M.Manifold.cube([4, 20, 1 + offset]);
      const terrain = compactManifoldMesh(cut.getMesh());
      const piece: Piece = {
        id: 'stripe',
        class: 'trail',
        mesh: compactManifoldMesh(part.getMesh()),
        origin: [8, 0, 2],
        insert_depth_mm: 1,
      };
      base.delete();
      cutter.delete();
      cut.delete();
      part.delete();
      const result = await assemblePaintedSurface(M, terrain, [piece]);
      const merged = solidFromMesh(M, result.mesh);
      expect(merged.volume()).toBeCloseTo(1200 + 80 * offset, 3);
      const components = merged.decompose();
      expect(components).toHaveLength(1);
      components.forEach(component => component.delete());
      merged.delete();
      let paintedTopArea = 0;
      for (let face = 0; face < result.faceMaterials.length; face++) {
        const vertices = Array.from(result.mesh.indices.slice(face * 3, face * 3 + 3)).map(index =>
          Array.from(result.mesh.positions.slice(index * 3, index * 3 + 3)),
        );
        // No triangle may remain on the buried floor of the temporary material partition.
        expect(vertices.every(p => Math.abs(p[2] - 2) < 1e-5)).toBe(false);
        if (
          vertices.every(p => Math.abs(p[2] - (3 + offset)) < 1e-5) &&
          result.faceMaterials[face] === 1
        ) {
          expect(vertices.every(p => p[0] >= 8 - 1e-5 && p[0] <= 12 + 1e-5)).toBe(true);
          const [a, b, c] = vertices;
          paintedTopArea +=
            Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
        }
      }
      expect(paintedTopArea).toBeCloseTo(80, 4);
    },
  );

  it('ignores user fit depth when constructing painted surfaces', () => {
    const first = paintedBuildInputs({ ...defaults, insert_depth_mm: 2 }, []);
    const second = paintedBuildInputs({ ...defaults, insert_depth_mm: 10 }, []);
    expect(first).toEqual(second);
  });

  it('removes rounded interface slivers without changing exterior paint', () => {
    const base = M.Manifold.cube([20, 20, 3]);
    const sliver = M.Manifold.cube([1, 1, 0.00001]);
    const mesh = combineMeshes([
      compactManifoldMesh(base.getMesh()),
      compactManifoldMesh(sliver.getMesh()),
    ]);
    const materials = new Uint8Array(mesh.indices.length / 3).fill(1);
    materials[0] = 2;
    const result = removeNumericalShells(mesh, materials);
    expect(result.mesh.indices).toHaveLength(36);
    expect(Array.from(result.faceMaterials)).toEqual([2, ...Array(11).fill(1)]);
    base.delete();
    sliver.delete();
  });

  it('rejects genuine detached geometry rather than dropping a feature', () => {
    const base = M.Manifold.cube([20, 20, 3]);
    const feature = M.Manifold.cube([1, 1, 1]);
    const mesh = combineMeshes([
      compactManifoldMesh(base.getMesh()),
      compactManifoldMesh(feature.getMesh()),
    ]);
    expect(() => removeNumericalShells(mesh, new Uint8Array(mesh.indices.length / 3))).toThrow(
      'disconnected',
    );
    base.delete();
    feature.delete();
  });

  it('encodes whole-triangle filament assignments', () => {
    expect([1, 2, 3, 4, 16].map(trianglePaintCode)).toEqual(['4', '8', '0C', '1C', 'DC']);
    expect(() => trianglePaintCode(0)).toThrow();
  });
});

import { beforeAll, expect, it } from 'vitest';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import { multicolorCoupon } from '../src/multicolor-coupon';
import { solidFromMesh } from '../src/manifold-adapter';
let M: ManifoldToplevel;
beforeAll(async () => {
  M = await Module();
  M.setup();
});
it('creates one painted solid with nozzle-scaled lines and three surface heights', async () => {
  const { asset, legend } = await multicolorCoupon(M, 0.4);
  expect(legend.line_widths_left_to_right_mm).toEqual([
    0.30000000000000004, 0.4, 0.6000000000000001, 0.8,
  ]);
  expect(new Set(asset.faceMaterials)).toEqual(new Set([0, 1, 4]));
  const heights = new Set(
    Array.from(asset.terrain.positions)
      .filter((_, i) => i % 3 === 2)
      .map(z => Number(z.toFixed(2))),
  );
  for (const z of [0, 2.1, 2.4, 2.75]) expect(heights.has(z)).toBe(true);
  const solid = solidFromMesh(M, asset.terrain);
  const parts = solid.decompose();
  expect(parts).toHaveLength(1);
  parts.forEach(part => part.delete());
  solid.delete();
});

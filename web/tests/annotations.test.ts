import { describe, it, expect } from 'vitest';
import { annotationGeometry, type Annotation } from '../src/annotations';
import { defaults, type Grid, type Layout } from '../src/types';
const g: Grid = { bounds: [0, 0, 1, 1], width: 2, height: 2, elevations: [100, 100, 100, 100] };
const l: Layout = {
  bounds: g.bounds,
  width: 100,
  depth: 100,
  scale: 1,
  rotated: false,
  minimum: 100,
  height_factor: 1,
  base_height: 1,
};
const a: Annotation = {
  id: 'test',
  name: 'Test',
  kind: 'text',
  text: 'X',
  threshold: 128,
  invert: false,
  mask: [1, 0, 0, 1],
  pixels_w: 2,
  pixels_h: 2,
  enabled: true,
  placement: 'terrain',
  treatment: 'raised',
  x_mm: 50,
  y_mm: 50,
  width_mm: 10,
  height_mm: 10,
  angle_deg: 0,
  depth_mm: 0.6,
  porch_depth_mm: 16,
  porch_align: 'base',
};
describe('annotation solids', () => {
  it('keeps raised geometry connected and retains relief height', () => {
    const r = annotationGeometry(a, g, defaults, l);
    expect(r.solids.length).toBeGreaterThan(0);
    for (const m of r.solids) {
      expect(Math.min(...Array.from(m.positions).filter((_, i) => i % 3 === 2))).toBe(0.3);
      expect(Math.max(...Array.from(m.positions).filter((_, i) => i % 3 === 2))).toBeCloseTo(
        1.6,
        8,
      );
    }
  });
  it('preserves the engraving floor', () => {
    const r = annotationGeometry({ ...a, treatment: 'engraved', depth_mm: 5 }, g, defaults, l);
    expect(
      Math.min(...r.solids.flatMap(m => Array.from(m.positions).filter((_, i) => i % 3 === 2))),
    ).toBe(0.4);
  });
  it('rejects labels outside the terrain', () =>
    expect(() => annotationGeometry({ ...a, x_mm: 0 }, g, defaults, l)).toThrow('fully inside'));
  it('attaches porches across the boundary', () => {
    const r = annotationGeometry({ ...a, placement: 'porch', y_mm: 1 }, g, defaults, l);
    const y = Array.from(r.porch!.positions).filter((_, i) => i % 3 === 1);
    expect(Math.min(...y)).toBeLessThan(0);
    expect(Math.max(...y)).toBeGreaterThan(0);
  });
  it('builds finite rotated solids for disconnected logo regions', () => {
    const result = annotationGeometry(
      {
        ...a,
        kind: 'png',
        angle_deg: 37,
        pixels_w: 4,
        pixels_h: 3,
        mask: [1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1],
      },
      g,
      defaults,
      l,
    );
    expect(result.solids.length).toBeGreaterThan(1);
    for (const mesh of result.solids) {
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
      expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
    }
  });
  it('rejects empty converted artwork', () =>
    expect(() => annotationGeometry({ ...a, mask: [0, 0, 0, 0] }, g, defaults, l)).toThrow(
      'empty',
    ));
});

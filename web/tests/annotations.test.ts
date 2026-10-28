import { describe, it, expect } from 'vitest';
import {
  annotationGeometry,
  annotationPatches,
  surfaceZ,
  type Annotation,
} from '../src/annotations';
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

it('preserves foreground and holes at pixel centers through split/join rows', () => {
  const rows = ['00111100', '00111100', '00100100', '00100100', '00111100', '00011000'];
  const mask = rows.join('').split('').map(Number);
  const reconstructed = Array(mask.length).fill(0);
  const patches = annotationPatches(mask, 8, rows.length);
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < 8; x++)
      for (const p of patches) {
        if (y + 0.5 < p.top || y + 0.5 >= p.bottom) continue;
        const v = (y + 0.5 - p.top) / (p.bottom - p.top);
        const left = p.left + (p.bottomLeft - p.left) * v;
        const right = p.right + (p.bottomRight - p.right) * v;
        if (x + 0.5 > left && x + 0.5 < right) reconstructed[y * 8 + x]++;
      }
  expect(reconstructed).toEqual(mask);
});

it('uses three patches including interpolated corner caps for a large filled mask', () => {
  const high = {
    ...a,
    placement: 'porch' as const,
    width_mm: 10,
    height_mm: 5,
    pixels_w: 512,
    pixels_h: 192,
    mask: Array(512 * 192).fill(1),
  };
  expect(annotationPatches(high.mask, high.pixels_w, high.pixels_h)).toHaveLength(3);
  for (const treatment of ['raised', 'engraved'] as const) {
    const geometry = annotationGeometry({ ...high, treatment }, g, defaults, l);
    expect(geometry.solids).toHaveLength(3);
    expect(geometry.preview).toHaveLength(3);
  }
});

it('merges a long diagonal into a sloped trapezoid instead of pixel steps', () => {
  const width = 40,
    height = 30;
  const mask = Array.from({ length: width * height }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width);
    return Number(x >= y && x < y + 8);
  });
  const patches = annotationPatches(mask, width, height);
  const diagonal = patches.find(p => p.bottom - p.top > 20);
  expect(diagonal).toBeDefined();
  expect(diagonal!.bottomLeft - diagonal!.left).toBe(diagonal!.bottom - diagonal!.top);
  expect(diagonal!.bottomRight - diagonal!.right).toBe(diagonal!.bottom - diagonal!.top);
  expect(patches.length).toBeLessThan(8);
});

it('keeps diagonal contacts separate and caps isolated pixels', () => {
  const patches = annotationPatches([1, 0, 0, 1], 2, 2);
  const area = patches.reduce(
    (sum, p) =>
      sum + ((p.right - p.left + (p.bottomRight - p.bottomLeft)) * (p.bottom - p.top)) / 2,
    0,
  );
  expect(area).toBe(1);
  expect(patches).toHaveLength(4);
  expect(patches.every(p => p.bottom <= 1 || p.top >= 1)).toBe(true);
});

it('subdivides sloped patches and samples their height on non-flat terrain', () => {
  const grid = { ...g, elevations: [100, 110, 105, 120] };
  const label = {
    ...a,
    pixels_w: 8,
    pixels_h: 8,
    mask: Array.from({ length: 64 }, (_, i) => Number(i % 8 <= Math.floor(i / 8))),
  };
  const geometry = annotationGeometry(label, grid, defaults, l);
  for (const mesh of geometry.solids) {
    const xs = [],
      ys = [];
    for (let i = 0; i < 12; i += 3) {
      const [x, y, z] = Array.from(mesh.positions).slice(i, i + 3);
      xs.push(x);
      ys.push(y);
      expect(z).toBeCloseTo(surfaceZ(grid, l, x, y) + label.depth_mm, 8);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1.001);
    // A sloped cell can move up to 1 mm horizontally as well as spanning 1 mm.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(2.001);
  }
});

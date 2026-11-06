import { describe, it, expect } from 'vitest';
import {
  annotationGeometry,
  annotationPatches,
  surfaceZ,
  annotationFrame,
  annotationPoint,
  nearestBoundaryPoint,
  type Annotation,
} from '../src/annotations';
import { defaults, type Grid, type Layout } from '../src/types';
import * as THREE from 'three';
import { AnnotationEditor } from '../src/annotation-editor';
import { Viewer } from '../src/viewer';
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
it('keeps partial and fully outside annotations visible without weakening export validation', () => {
  for (const drape of [true, false])
    for (const x_mm of [1, -20]) {
      const moved = { ...a, x_mm, drape };
      const preview = annotationGeometry(moved, g, defaults, l, true);
      expect(preview.ghost.length).toBeGreaterThan(0);
      expect(preview.warnings.length).toBeGreaterThan(0);
      expect(preview.ghost.flatMap(mesh => Array.from(mesh.positions)).every(Number.isFinite)).toBe(
        true,
      );
      if (x_mm === 1) expect(preview.preview.length).toBeGreaterThan(0);
      expect(() => annotationGeometry(moved, g, defaults, l)).toThrow('inside');
    }
});
it('omits the relief grid from flat artwork while sampling interior terrain peaks and valleys', () => {
  const label = {
    ...a,
    pixels_w: 4,
    pixels_h: 4,
    mask: Array(16).fill(1),
    width_mm: 20,
    height_mm: 20,
  };
  for (const treatment of ['raised', 'engraved'] as const) {
    const elevations = Array(9).fill(110);
    elevations[4] = treatment === 'raised' ? 120 : 100;
    const grid = { ...g, width: 3, height: 3, elevations };
    const draped = annotationGeometry({ ...label, treatment }, grid, defaults, l, true);
    const flat = annotationGeometry({ ...label, treatment, drape: false }, grid, defaults, l, true);
    const tops = (meshes: typeof flat.preview) =>
      meshes.flatMap(mesh => [2, 5, 8, 11].map(i => Number(mesh.positions[i])));
    const sampled = tops(draped.preview);
    const expected = treatment === 'raised' ? Math.max(...sampled) : Math.min(...sampled);
    expect(flat.preview).toHaveLength(3);
    expect(flat.solids).toHaveLength(3);
    expect(draped.preview.length).toBeGreaterThan(flat.preview.length);
    for (const top of tops(flat.preview)) expect(top).toBeCloseTo(expected, 8);
    // The 1 mm samples reach the interior extremum, far beyond the patch corners.
    if (treatment === 'raised') expect(expected).toBeGreaterThan(21);
    else expect(expected).toBeLessThan(1);
    expect(flat.ghost).toHaveLength(0);
  }
});
it('keeps planar preview lighting independent of prism side-wall normals', () => {
  for (const treatment of ['raised', 'engraved'] as const) {
    for (const drape of [true, false]) {
      const group = new THREE.Group();
      const state = {
        group,
        state: () => ({
          project: { grid: g, settings: defaults, annotations: [{ ...a, treatment, drape }] },
          terrain: { layout: l },
        }),
        viewer: {
          geometry: Viewer.prototype.geometry,
          annotationCuts() {},
          annotationFaceCuts() {},
          invalidate() {},
        },
        message() {},
      };
      AnnotationEditor.prototype.refresh.call(state as unknown as AnnotationEditor);
      expect(group.children).toHaveLength(1);
      const mesh = group.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;
      expect(mesh.material.flatShading).toBe(!drape);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});
it('selects adjacent sides continuously and clamps at polygon corners', () => {
  const poly: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ];
  expect(nearestBoundaryPoint(poly, 95, -1)).toEqual({ side_index: 0, x_mm: 95, y_mm: 0 });
  expect(nearestBoundaryPoint(poly, 101, 5)).toEqual({ side_index: 1, x_mm: 100, y_mm: 5 });
  expect(nearestBoundaryPoint(poly, -3, -4)).toMatchObject({ x_mm: 0, y_mm: 0 });
});
it('keeps old terrain annotations draped and makes flat treatments use a common height', () => {
  const slope = { ...g, elevations: [100, 110, 102, 115] };
  const draped = annotationGeometry(a, slope, defaults, l);
  const explicit = annotationGeometry({ ...a, drape: true }, slope, defaults, l);
  expect(draped.solids).toEqual(explicit.solids);
  const tops = (result: ReturnType<typeof annotationGeometry>) =>
    result.solids.flatMap(mesh => [2, 5, 8, 11].map(i => Number(mesh.positions[i])));
  expect(new Set(tops(draped)).size).toBeGreaterThan(1);
  const flat = annotationGeometry({ ...a, drape: false }, slope, defaults, l);
  expect(new Set(tops(flat)).size).toBe(1);
  const engraved = annotationGeometry(
    { ...a, treatment: 'engraved', drape: false },
    slope,
    defaults,
    l,
  );
  expect(
    new Set(engraved.solids.flatMap(mesh => [14, 17, 20, 23].map(i => Number(mesh.positions[i]))))
      .size,
  ).toBe(1);
});
it('orients readable bottom text and outward side text with right-handed frames', () => {
  for (const placement of ['bottom', 'side'] as const) {
    for (const side_index of [0, 1, 2, 3]) {
      const label = { ...a, placement, side_index };
      const frame = annotationFrame(label, defaults, l);
      const point = [12, 3, -0.6];
      annotationPoint(frame, annotationPoint(frame, point), true).forEach((value, i) =>
        expect(value).toBeCloseTo(point[i]),
      );
      const cross = [
        frame.u[1] * frame.v[2] - frame.u[2] * frame.v[1],
        frame.u[2] * frame.v[0] - frame.u[0] * frame.v[2],
        frame.u[0] * frame.v[1] - frame.u[1] * frame.v[0],
      ];
      cross.forEach((value, i) => expect(value).toBeCloseTo(frame.n[i]));
    }
  }
  const frame = annotationFrame({ ...a, placement: 'bottom' }, defaults, l);
  expect(frame.v).toEqual([0, -1, 0]);
  const bottom = annotationGeometry({ ...a, placement: 'bottom' }, g, defaults, l);
  expect(bottom.center).toEqual([50, 50, 0]);
  expect(
    Math.min(
      ...bottom.solids.flatMap(mesh => Array.from(mesh.positions).filter((_, i) => i % 3 === 2)),
    ),
  ).toBeCloseTo(-0.6);
});
it('fits side artwork within the selected wall and retains backing material', () => {
  const label: Annotation = {
    ...a,
    placement: 'side',
    side_index: 0,
    y_mm: 0,
    z_mm: 5,
    height_mm: 4,
  };
  const tall = { ...l, base_height: 10 };
  const side = annotationGeometry(label, g, defaults, tall);
  expect(side.center).toEqual([50, 0, 5]);
  expect(() => annotationGeometry({ ...label, height_mm: 12 }, g, defaults, tall)).toThrow(
    'backing',
  );
  expect(() => annotationGeometry({ ...label, x_mm: 99 }, g, defaults, tall)).toThrow();
  expect(() =>
    annotationGeometry(
      { ...a, placement: 'bottom', treatment: 'engraved', depth_mm: 2 },
      g,
      defaults,
      l,
    ),
  ).toThrow('backing');
});
it('uses the same physical side for either polygon winding and rotated model layouts', () => {
  const boundary: [number, number][] = [
    [0.1, 0.1],
    [0.9, 0.3],
    [0.8, 0.9],
    [0.2, 0.8],
  ];
  for (const rotated of [false, true]) {
    const layout = { ...l, rotated, base_height: 10 };
    for (const clockwise of [false, true]) {
      const polygon = clockwise ? [...boundary].reverse() : boundary;
      const label: Annotation = {
        ...a,
        placement: 'side',
        side_index: 0,
        z_mm: 5,
        width_mm: 8,
        height_mm: 4,
      };
      const frame = annotationFrame(label, { ...defaults, boundary: polygon }, layout);
      const length = Math.hypot(...[0, 1].map(i => polygon[1][i] - polygon[0][i])) * 100;
      const center = annotationPoint(frame, [clockwise ? -length / 2 : length / 2, 5, 0]);
      label.x_mm = center[0];
      label.y_mm = center[1];
      const result = annotationGeometry(label, g, { ...defaults, boundary: polygon }, layout);
      result.center.forEach((value, i) => expect(value).toBeCloseTo(center[i]));
    }
  }
});
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

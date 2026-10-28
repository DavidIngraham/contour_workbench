/** Printable text and monochrome artwork geometry shared by preview and generation. */
import type { Grid, Layout, Mesh, Settings } from './types';
/** Local font families; the saved raster mask preserves the exact printable glyphs. */
export const annotationFonts = {
  'sans-serif': 'Sans serif',
  serif: 'Serif',
  monospace: 'Monospace',
} as const;
/** Older projects and unknown font values retain the original sans-serif default. */
export function annotationFont(value?: string): keyof typeof annotationFonts {
  return value && Object.hasOwn(annotationFonts, value)
    ? (value as keyof typeof annotationFonts)
    : 'sans-serif';
}
/** Serializable text or monochrome PNG annotation. */
export interface Annotation {
  id: string;
  name: string;
  kind: 'text' | 'png';
  text: string;
  font?: keyof typeof annotationFonts;
  image?: string;
  threshold: number;
  invert: boolean;
  mask: number[];
  pixels_w: number;
  pixels_h: number;
  enabled: boolean;
  placement: 'terrain' | 'porch';
  treatment: 'raised' | 'engraved';
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  angle_deg: number;
  depth_mm: number;
  porch_depth_mm: number;
  porch_align: 'base' | 'edge';
}
/** Convert longitude/latitude to model XY millimeters. */
export function xy(l: Layout, p: number[]): [number, number] {
  const u = (p[0] - l.bounds[0]) / (l.bounds[2] - l.bounds[0]),
    v = (p[1] - l.bounds[1]) / (l.bounds[3] - l.bounds[1]);
  return l.rotated ? [(1 - v) * l.width, u * l.depth] : [u * l.width, v * l.depth];
}
/** Bilinearly sample model-surface Z at model XY coordinates. */
export function surfaceZ(g: Grid, l: Layout, x: number, y: number) {
  const u = l.rotated ? y / l.depth : x / l.width,
    v = l.rotated ? 1 - x / l.width : y / l.depth;
  const lon = l.bounds[0] + u * (l.bounds[2] - l.bounds[0]),
    lat = l.bounds[1] + v * (l.bounds[3] - l.bounds[1]);
  const gx = Math.max(
      0,
      Math.min(g.width - 1, ((lon - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
    ),
    gy = Math.max(
      0,
      Math.min(g.height - 1, ((lat - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1)),
    );
  const i = Math.min(g.width - 2, Math.floor(gx)),
    j = Math.min(g.height - 2, Math.floor(gy)),
    a = gx - i,
    b = gy - j;
  const z =
    g.elevations[j * g.width + i] * (1 - a) * (1 - b) +
    g.elevations[j * g.width + i + 1] * a * (1 - b) +
    g.elevations[(j + 1) * g.width + i] * (1 - a) * b +
    g.elevations[(j + 1) * g.width + i + 1] * a * b;
  return (z - l.minimum) * l.scale * l.height_factor + l.base_height;
}
/** Return the printable terrain boundary in model XY millimeters. */
export function boundaryXY(s: Settings, l: Layout): [number, number][] {
  return s.boundary.length
    ? s.boundary.map(p => xy(l, p))
    : [
        [0, 0],
        [l.width, 0],
        [l.width, l.depth],
        [0, l.depth],
      ];
}
function inside(p: number[], poly: number[][]) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
/** Snap an annotation porch to the nearest sufficiently long boundary segment. */
export function snapPorch(a: Annotation, s: Settings, l: Layout) {
  const poly = boundaryXY(s, l);
  let best = Infinity,
    found: any;
  const area = poly.reduce((v, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return v + p[0] * q[1] - q[0] * p[1];
  }, 0);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      dx = q[0] - p[0],
      dy = q[1] - p[1],
      len = Math.hypot(dx, dy);
    if (len < a.width_mm + 7) continue;
    const margin = (a.width_mm + 6) / 2 / len,
      t = Math.max(
        margin,
        Math.min(1 - margin, ((a.x_mm - p[0]) * dx + (a.y_mm - p[1]) * dy) / len ** 2),
      ),
      x = p[0] + t * dx,
      y = p[1] + t * dy,
      d = Math.hypot(x - a.x_mm, y - a.y_mm);
    if (d < best) {
      best = d;
      const sign = area > 0 ? 1 : -1;
      found = { x, y, ux: (dx / len) * sign, uy: (dy / len) * sign };
    }
  }
  if (!found)
    throw new Error(
      'This porch needs a longer straight boundary edge. Reduce its width or use terrain placement.',
    );
  return found;
}
function prism(
  points: number[][],
  top: (x: number, y: number) => number,
  bottom: (x: number, y: number) => number,
): Mesh {
  const positions = [
    ...points.flatMap(p => [...p, top(p[0], p[1])]),
    ...points.flatMap(p => [...p, bottom(p[0], p[1])]),
  ];
  return {
    positions,
    indices: [
      0, 1, 2, 0, 2, 3, 6, 5, 4, 7, 6, 4, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3,
      7, 4, 3, 4, 0,
    ],
  };
}
/** Trace the mask at half coverage and decompose its outline into horizontal trapezoids. */
export function annotationPatches(mask: number[], width: number, height: number) {
  type Patch = {
    left: number;
    right: number;
    bottomLeft: number;
    bottomRight: number;
    top: number;
    bottom: number;
  };
  type Point = [number, number];
  const bands = new Map<number, { topX: number; bottomX: number }[]>();
  const sample = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && !!mask[y * width + x];
  // Marching squares on pixel centers. At diagonal contacts, keep the two
  // foreground islands separate instead of creating a zero-width connection.
  const cases: number[][][] = [
    [],
    [[3, 0]],
    [[0, 1]],
    [[3, 1]],
    [[1, 2]],
    [
      [3, 0],
      [1, 2],
    ],
    [[0, 2]],
    [[3, 2]],
    [[2, 3]],
    [[0, 2]],
    [
      [0, 1],
      [2, 3],
    ],
    [[1, 2]],
    [[1, 3]],
    [[0, 1]],
    [[3, 0]],
    [],
  ];
  for (let y = -1; y < height; y++)
    for (let x = -1; x < width; x++) {
      const code =
        Number(sample(x, y)) +
        2 * Number(sample(x + 1, y)) +
        4 * Number(sample(x + 1, y + 1)) +
        8 * Number(sample(x, y + 1));
      if (!code || code === 15) continue;
      const points: Point[] = [
        [x + 1, y + 0.5],
        [x + 1.5, y + 1],
        [x + 1, y + 1.5],
        [x + 0.5, y + 1],
      ];
      for (const [i, j] of cases[code]) {
        let a = points[i],
          b = points[j];
        if (a[1] === b[1]) continue;
        if (a[1] > b[1]) [a, b] = [b, a];
        const at = (v: number) => a[0] + ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]);
        for (let top = a[1]; top < b[1]; top += 0.5) {
          const edges = bands.get(top) ?? [];
          edges.push({ topX: at(top), bottomX: at(top + 0.5) });
          bands.set(top, edges);
        }
      }
    }
  const patches: Patch[] = [];
  let active = new Map<string, Patch>();
  for (const [top, edges] of [...bands].sort((a, b) => a[0] - b[0])) {
    edges.sort((a, b) => a.topX + a.bottomX - b.topX - b.bottomX);
    const next = new Map<string, Patch>();
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const left = edges[i],
        right = edges[i + 1];
      const ls = (left.bottomX - left.topX) * 2,
        rs = (right.bottomX - right.topX) * 2;
      const key = `${left.topX}:${right.topX}:${ls}:${rs}`;
      let patch = active.get(key);
      if (!patch || patch.bottom !== top)
        patch = {
          left: left.topX,
          right: right.topX,
          bottomLeft: left.topX,
          bottomRight: right.topX,
          top,
          bottom: top,
        };
      else active.delete(key);
      patch.bottom = top + 0.5;
      patch.bottomLeft = left.bottomX;
      patch.bottomRight = right.bottomX;
      next.set(`${left.bottomX}:${right.bottomX}:${ls}:${rs}`, patch);
    }
    patches.push(...active.values());
    active = next;
  }
  patches.push(...active.values());
  return patches;
}
/** Build preview solids, boolean solids, and an optional attached porch. */
export function annotationGeometry(a: Annotation, g: Grid, s: Settings, l: Layout) {
  if (
    ![a.x_mm, a.y_mm, a.width_mm, a.height_mm, a.angle_deg, a.depth_mm, a.porch_depth_mm].every(
      Number.isFinite,
    ) ||
    a.width_mm <= 0 ||
    a.height_mm <= 0 ||
    a.depth_mm <= 0 ||
    a.depth_mm > 10 ||
    a.pixels_w < 1 ||
    a.pixels_h < 1 ||
    a.pixels_w * a.pixels_h > 262144 ||
    a.mask.length !== a.pixels_w * a.pixels_h
  )
    throw new Error('Invalid annotation dimensions or image.');
  const poly = boundaryXY(s, l);
  let cx = a.x_mm,
    cy = a.y_mm,
    angle = (a.angle_deg * Math.PI) / 180,
    porch: Mesh | undefined,
    flat = 0;
  let depth = Math.max(a.porch_depth_mm, a.height_mm + 6);
  if (a.placement === 'porch') {
    const edge = snapPorch(a, s, l);
    angle = Math.atan2(edge.uy, edge.ux);
    cx = edge.x + edge.uy * (depth / 2 - 0.5);
    cy = edge.y - edge.ux * (depth / 2 - 0.5);
    flat =
      a.porch_align === 'edge'
        ? Math.max(l.base_height, surfaceZ(g, l, edge.x, edge.y))
        : l.base_height;
    flat = Math.max(flat, a.depth_mm + 0.4);
    const w = a.width_mm + 6;
    const pts = [
      [-w / 2, -depth / 2],
      [w / 2, -depth / 2],
      [w / 2, depth / 2],
      [-w / 2, depth / 2],
    ].map(([x, y]) => [
      cx + x * Math.cos(angle) - y * Math.sin(angle),
      cy + x * Math.sin(angle) + y * Math.cos(angle),
    ]);
    porch = prism(
      pts,
      () => flat,
      () => 0,
    );
  }
  const c = Math.cos(angle),
    sn = Math.sin(angle),
    point = (x: number, y: number) => [cx + x * c - y * sn, cy + x * sn + y * c];
  const z = (x: number, y: number) => (porch ? flat : surfaceZ(g, l, x, y));
  const solids: Mesh[] = [],
    preview: Mesh[] = [];
  const dx = a.width_mm / a.pixels_w,
    dy = a.height_mm / a.pixels_h;
  for (const patch of annotationPatches(a.mask, a.pixels_w, a.pixels_h)) {
    // Flat porches need one prism per patch. Sample terrain at 1 mm intervals
    // across the width and along each side's displacement to retain relief.
    const columns = porch
      ? 1
      : Math.max(
          1,
          Math.ceil(Math.max(patch.right - patch.left, patch.bottomRight - patch.bottomLeft) * dx),
        );
    const rows = porch
      ? 1
      : Math.max(
          1,
          Math.ceil(
            Math.max(
              (patch.bottom - patch.top) * dy,
              Math.abs(patch.bottomLeft - patch.left) * dx,
              Math.abs(patch.bottomRight - patch.right) * dx,
            ),
          ),
        );
    const corner = (u: number, v: number, ex: number, ey: number) => {
      const left = patch.left + (patch.bottomLeft - patch.left) * v;
      const right = patch.right + (patch.bottomRight - patch.right) * v;
      return point(
        -a.width_mm / 2 + (left + (right - left) * u) * dx + ex,
        a.height_mm / 2 - (patch.top + (patch.bottom - patch.top) * v) * dy + ey,
      );
    };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        // Tiny overlaps keep adjacent Boolean pieces connected, including
        // triangular end caps represented as collapsed trapezoids.
        const points = [
          corner(col / columns, (row + 1) / rows, -0.0002, -0.0002),
          corner((col + 1) / columns, (row + 1) / rows, 0.0002, -0.0002),
          corner((col + 1) / columns, row / rows, 0.0002, 0.0002),
          corner(col / columns, row / rows, -0.0002, 0.0002),
        ];
        if (!porch && points.some(p => !inside(p, poly)))
          throw new Error(
            'Move the annotation fully inside the terrain, or choose an attached porch.',
          );
        const raised = a.treatment === 'raised';
        const floor = (x: number, y: number) => Math.max(0.4, z(x, y) - a.depth_mm);
        solids.push(
          prism(
            points,
            raised ? (x, y) => z(x, y) + a.depth_mm : (x, y) => z(x, y) + 2,
            raised ? () => 0.3 : floor,
          ),
        );
        preview.push(
          prism(
            points,
            raised ? (x, y) => z(x, y) + a.depth_mm : (x, y) => floor(x, y) + 0.002,
            raised ? z : (x, y) => floor(x, y) - 0.005,
          ),
        );
      }
    }
  }
  if (!solids.length)
    throw new Error('The annotation is empty. Adjust its text, threshold, or selected colors.');
  return {
    solids,
    preview,
    porch,
    center: [cx, cy, z(cx, cy)] as [number, number, number],
    angle,
    depth,
  };
}
/** Concatenate meshes while rebasing triangle indices. */
export function combineMeshes(meshes: Mesh[]): Mesh {
  const positions: number[] = [],
    indices: number[] = [];
  for (const m of meshes) {
    const n = positions.length / 3;
    positions.push(...m.positions);
    indices.push(...Array.from(m.indices, i => i + n));
  }
  return { positions, indices };
}

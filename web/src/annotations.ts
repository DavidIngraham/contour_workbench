/** Printable text and monochrome artwork geometry shared by preview and generation. */
import type { Grid, Layout, Mesh, Settings } from './types';
import { modelXY, modelLonLat } from './layout-transform';
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
  placement: 'terrain' | 'porch' | 'bottom' | 'side';
  /** Terrain relief is followed unless explicitly disabled. Other faces are always flat. */
  drape?: boolean;
  /** Boundary segment and height above the model bottom for side placement. */
  side_index?: number;
  z_mm?: number;
  treatment: 'raised' | 'engraved';
  /** Raised artwork can optionally be printed separately; absent in older projects. */
  as_insert?: boolean;
  /** Pocket depth below the lowest surface point; defaults to the project insert depth. */
  insert_depth_mm?: number;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  angle_deg: number;
  depth_mm: number;
  porch_depth_mm: number;
  porch_align: 'base' | 'edge';
}
/** Right-handed face coordinates: artwork XY and outward-facing Z. */
export interface AnnotationFrame {
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  n: [number, number, number];
}
/** Convert face-local coordinates to assembly coordinates, or the inverse. */
export function annotationPoint(
  frame: AnnotationFrame,
  point: number[],
  inverse = false,
): [number, number, number] {
  if (inverse) {
    const p = point.map((value, i) => value - frame.origin[i]);
    return [frame.u, frame.v, frame.n].map(axis =>
      axis.reduce((sum, value, i) => sum + value * p[i], 0),
    ) as [number, number, number];
  }
  return frame.origin.map(
    (value, i) => value + frame.u[i] * point[0] + frame.v[i] * point[1] + frame.n[i] * point[2],
  ) as [number, number, number];
}
/** Transform a mesh without changing its winding (face frames have determinant +1). */
export function annotationMesh(frame: AnnotationFrame, mesh: Mesh, inverse = false): Mesh {
  const positions: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3)
    positions.push(...annotationPoint(frame, Array.from(mesh.positions.slice(i, i + 3)), inverse));
  return { positions, indices: mesh.indices };
}
/** Select an outward-facing coordinate system, including arbitrary polygon sides. */
export function annotationFrame(a: Annotation, s: Settings, l: Layout): AnnotationFrame {
  if (a.placement === 'bottom')
    return { origin: [0, 0, 0], u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, -1] };
  if (a.placement === 'side') {
    const poly = boundaryXY(s, l);
    const index = a.side_index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= poly.length)
      throw new Error('Choose a model side.');
    const p = poly[index],
      q = poly[(index + 1) % poly.length];
    const sign =
      poly.reduce((sum, p, i) => {
        const q = poly[(i + 1) % poly.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0) > 0
        ? 1
        : -1;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length < 0.001) throw new Error('Choose a longer model side.');
    const ux = (sign * (q[0] - p[0])) / length,
      uy = (sign * (q[1] - p[1])) / length;
    return { origin: [p[0], p[1], 0], u: [ux, uy, 0], v: [0, 0, 1], n: [uy, -ux, 0] };
  }
  return { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
}
/** Convert longitude/latitude to model XY millimeters. */
export function xy(l: Layout, p: number[]): [number, number] {
  return modelXY(l, p);
}
/** Bilinearly sample model-surface Z at model XY coordinates. */
export function surfaceZ(g: Grid, l: Layout, x: number, y: number) {
  const [lon, lat] = modelLonLat(l, [x, y]);
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
        [l.bounds[0], l.bounds[1]],
        [l.bounds[2], l.bounds[1]],
        [l.bounds[2], l.bounds[3]],
        [l.bounds[0], l.bounds[3]],
      ].map(p => xy(l, p));
}
/** Find the nearest boundary segment and clamp the position to its endpoints. */
export function nearestBoundaryPoint(poly: [number, number][], x: number, y: number) {
  let best = { side_index: 0, x_mm: x, y_mm: y };
  let distance = Infinity;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0],
      dy = q[1] - p[1];
    const t = Math.max(
      0,
      Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / Math.max(1e-12, dx * dx + dy * dy)),
    );
    const px = p[0] + t * dx,
      py = p[1] + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < distance) {
      distance = d;
      best = { side_index: i, x_mm: px, y_mm: py };
    }
  });
  return best;
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
export function annotationGeometry(
  a: Annotation,
  g: Grid,
  s: Settings,
  l: Layout,
  previewOnly = false,
) {
  const warnings = new Set<string>();
  const ghostCells = new Set<number[][]>();
  const ghost: Mesh[] = [];
  const insert = a.as_insert === true;
  const insertDepthMm = a.insert_depth_mm ?? s.insert_depth_mm;
  if (
    !['terrain', 'porch', 'bottom', 'side'].includes(a.placement) ||
    (a.z_mm !== undefined && !Number.isFinite(a.z_mm)) ||
    (a.drape !== undefined && typeof a.drape !== 'boolean') ||
    ![a.x_mm, a.y_mm, a.width_mm, a.height_mm, a.angle_deg, a.depth_mm, a.porch_depth_mm].every(
      Number.isFinite,
    ) ||
    a.width_mm <= 0 ||
    a.height_mm <= 0 ||
    (insert ? a.depth_mm < 0 : a.depth_mm <= 0) ||
    a.depth_mm > 10 ||
    a.pixels_w < 1 ||
    a.pixels_h < 1 ||
    a.pixels_w * a.pixels_h > 262144 ||
    a.mask.length !== a.pixels_w * a.pixels_h
  )
    throw new Error('Invalid annotation dimensions or image.');
  if (
    insert &&
    (a.treatment !== 'raised' ||
      !Number.isFinite(insertDepthMm) ||
      insertDepthMm <= 0 ||
      insertDepthMm > 10)
  )
    throw new Error('Choose a positive annotation insert depth up to 10 mm.');
  const poly = boundaryXY(s, l);
  const frame = annotationFrame(a, s, l);
  const face = a.placement === 'bottom' || a.placement === 'side';
  const localCenter = annotationPoint(frame, [a.x_mm, a.y_mm, a.z_mm ?? l.base_height / 2], true);
  let cx = a.x_mm,
    cy = a.y_mm,
    angle = (a.angle_deg * Math.PI) / 180,
    porch: Mesh | undefined,
    flat = 0;
  if (face) {
    cx = localCenter[0];
    cy = localCenter[1];
  }
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
    flat = Math.max(flat, (insert ? insertDepthMm : a.depth_mm) + 0.4);
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
  const sampleZ = (x: number, y: number) => (face ? 0 : porch ? flat : surfaceZ(g, l, x, y));
  const solids: Mesh[] = [],
    preview: Mesh[] = [];
  const cells: number[][][] = [];
  let lowestSurfaceMm = Infinity,
    highestSurfaceMm = -Infinity;
  const dx = a.width_mm / a.pixels_w,
    dy = a.height_mm / a.pixels_h;
  for (const patch of annotationPatches(a.mask, a.pixels_w, a.pixels_h)) {
    // Sample terrain/backing at 1 mm intervals even for flat artwork: interior
    // peaks determine its seating height, and unsupported regions must ghost.
    const patchStart = cells.length;
    const columns =
      porch || (face && !previewOnly)
        ? 1
        : Math.max(
            1,
            Math.ceil(
              Math.max(patch.right - patch.left, patch.bottomRight - patch.bottomLeft) * dx,
            ),
          );
    const rows =
      porch || (face && !previewOnly)
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
        let invalid = false;
        const issue = (message: string) => {
          if (!previewOnly) throw new Error(message);
          warnings.add(message);
          invalid = true;
        };
        if (
          face &&
          points.some(p => {
            const required = insert ? insertDepthMm : a.treatment === 'engraved' ? a.depth_mm : 0;
            const backing = annotationPoint(frame, [...p, -required - 0.4]);
            return (
              !inside(backing, poly) ||
              backing[2] < 0 ||
              backing[2] > surfaceZ(g, l, backing[0], backing[1])
            );
          })
        )
          issue(
            'The annotation needs at least 0.4 mm of solid backing. Reduce its depth or move it.',
          );
        if (
          a.placement === 'side' &&
          points.some(p => {
            const end = poly[((a.side_index ?? 0) + 1) % poly.length];
            const endLocal = annotationPoint(frame, [...end, 0], true)[0];
            const world = annotationPoint(frame, [...p, -0.001]);
            // Check both the selected segment and actual boundary interior; concave
            // corners must not silently turn a side label into a wraparound label.
            return (
              p[0] < Math.min(0, endLocal) + 0.2 ||
              p[0] > Math.max(0, endLocal) - 0.2 ||
              !inside(world, poly) ||
              world[2] < 0.2 ||
              world[2] > surfaceZ(g, l, world[0], world[1]) - 0.2
            );
          })
        )
          issue(
            'Fit the annotation within the selected side. Reduce its height or raise the model base.',
          );
        if (
          a.placement !== 'side' &&
          !porch &&
          points.some(p => !inside(face ? annotationPoint(frame, [...p, 0]) : p, poly))
        )
          issue('Move the annotation fully inside the terrain, or choose an attached porch.');
        cells.push(points);
        if (invalid) ghostCells.add(points);
        for (const [x, y] of points) {
          lowestSurfaceMm = Math.min(lowestSurfaceMm, sampleZ(x, y));
          highestSurfaceMm = Math.max(highestSurfaceMm, sampleZ(x, y));
        }
      }
    }
    if (a.placement === 'terrain' && a.drape === false) {
      const sampled = cells.slice(patchStart);
      const ghosted = ghostCells.has(sampled[0]);
      // Flat surfaces need only the traced outline, not a relief grid. Keep the
      // grid only where a patch crosses the support boundary so ghosting stays local.
      if (sampled.every(points => ghostCells.has(points) === ghosted)) {
        const outline = [
          corner(0, 1, -0.0002, -0.0002),
          corner(1, 1, 0.0002, -0.0002),
          corner(1, 0, 0.0002, 0.0002),
          corner(0, 0, -0.0002, 0.0002),
        ];
        cells.length = patchStart;
        cells.push(outline);
        for (const points of sampled) ghostCells.delete(points);
        if (ghosted) ghostCells.add(outline);
      }
    }
  }
  // Every disconnected letter shares a flat seating plane. Relief remains on
  // the top, so the parts can print bottom-down without supports.
  const z = (x: number, y: number) =>
    a.drape === false && a.placement === 'terrain'
      ? a.treatment === 'engraved'
        ? lowestSurfaceMm
        : highestSurfaceMm
      : sampleZ(x, y);
  const minimumFloor = face ? -Infinity : 0.4;
  const floorMm = Math.max(minimumFloor, lowestSurfaceMm - insertDepthMm);
  if (
    !previewOnly &&
    a.placement === 'bottom' &&
    Math.max(insert ? insertDepthMm : a.treatment === 'engraved' ? a.depth_mm : 0, 0) >
      l.base_height - 0.4
  )
    throw new Error(
      'Increase the model base height to leave at least 0.4 mm above the bottom annotation.',
    );
  if (!previewOnly && insert && lowestSurfaceMm - floorMm < 0.2 - 1e-8)
    throw new Error(
      'The annotation needs at least 0.2 mm of pocket depth. Increase the base height or move it to higher terrain.',
    );
  for (const points of cells) {
    const raised = a.treatment === 'raised';
    const floor = (x: number, y: number) => Math.max(minimumFloor, z(x, y) - a.depth_mm);
    solids.push(
      prism(
        points,
        raised ? (x, y) => z(x, y) + a.depth_mm : (x, y) => z(x, y) + 2,
        insert ? () => floorMm : raised ? () => (face ? -0.3 : 0.3) : floor,
      ),
    );
    (ghostCells.has(points) ? ghost : preview).push(
      prism(
        points,
        raised ? (x, y) => z(x, y) + a.depth_mm : (x, y) => floor(x, y) + 0.002,
        insert ? () => floorMm : raised ? z : (x, y) => floor(x, y) - 0.005,
      ),
    );
  }
  if (!solids.length)
    throw new Error('The annotation is empty. Adjust its text, threshold, or selected colors.');
  return {
    solids: face ? solids.map(mesh => annotationMesh(frame, mesh)) : solids,
    preview: face ? preview.map(mesh => annotationMesh(frame, mesh)) : preview,
    ghost: face ? ghost.map(mesh => annotationMesh(frame, mesh)) : ghost,
    warnings: [...warnings],
    frame,
    porch,
    center: annotationPoint(frame, [cx, cy, z(cx, cy)]),
    angle,
    depth,
    floorMm,
    insertDepthMm: lowestSurfaceMm - floorMm,
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

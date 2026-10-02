/** Validation helpers for user-drawn geographic terrain extents. */
import type { Bounds } from './types';
import { checkBounds } from './providers';
/** Longitude/latitude vertex. */
export type Vertex = [number, number];
/** Compute west/south/east/north bounds for a polygon. */
export function polygonBounds(points: Vertex[]): Bounds {
  return [
    Math.min(...points.map(p => p[0])),
    Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])),
    Math.max(...points.map(p => p[1])),
  ];
}
/** Reject unsupported, degenerate, or self-intersecting terrain boundaries. */
export function validatePolygon(points: Vertex[]): void {
  if (points.length < 3) throw new Error('Draw at least three vertices.');
  if (points.length > 500) throw new Error('Use at most 500 boundary vertices.');
  if (points.some(p => p.some(v => !Number.isFinite(v))))
    throw new Error('Boundary coordinates must be finite.');
  checkBounds(polygonBounds(points));
  const orient = (a: Vertex, b: Vertex, c: Vertex) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Vertex, b: Vertex, p: Vertex) =>
    Math.abs(orient(a, b, p)) < 1e-14 &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a[0] === b[0] && a[1] === b[1]) throw new Error('Remove duplicate neighboring vertices.');
    area +=
      (a[0] - points[0][0]) * (b[1] - points[0][1]) - (b[0] - points[0][0]) * (a[1] - points[0][1]);
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        throw new Error('Boundary edges cannot cross or touch. Move a vertex or redraw.');
    }
  }
  if (Math.abs(area) < 1e-12) throw new Error('Draw a polygon with a nonzero area.');
}

import type { Bounds, Feature } from './types';
type Point = [number, number];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];

function inside(point: Point, ring: Point[]) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    const area = cross(sub(b, a), sub(point, a));
    if (
      Math.abs(area) < 1e-14 &&
      point[0] >= Math.min(a[0], b[0]) &&
      point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) &&
      point[1] <= Math.max(a[1], b[1])
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

/** Classify complete track segments against the terrain footprint, including concave boundaries. */
export function gpxPlacement(feature: Feature, bounds: Bounds, boundary?: Point[]) {
  const rectangle: Point[] = [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[1]],
    [bounds[2], bounds[3]],
    [bounds[0], bounds[3]],
  ];
  const rings = boundary?.length ? [rectangle, boundary] : [rectangle];
  let overlaps = false,
    outside = false;
  for (const line of feature.lines)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        delta = sub(line[i], a);
      if (Math.hypot(...delta) < 1e-14) continue;
      const breaks = [0, 1];
      for (const ring of rings)
        for (let j = 0; j < ring.length; j++) {
          const edge = sub(ring[(j + 1) % ring.length], ring[j]);
          const denominator = cross(delta, edge);
          if (Math.abs(denominator) < 1e-20) continue;
          const relative = sub(ring[j], a);
          const t = cross(relative, edge) / denominator,
            u = cross(relative, delta) / denominator;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) breaks.push(t);
        }
      breaks.sort((a, b) => a - b);
      for (let j = 1; j < breaks.length; j++) {
        if (breaks[j] - breaks[j - 1] < 1e-10) continue;
        const t = (breaks[j] + breaks[j - 1]) / 2;
        const point: Point = [a[0] + delta[0] * t, a[1] + delta[1] * t];
        if (rings.every(ring => inside(point, ring))) overlaps = true;
        else outside = true;
      }
    }
  return overlaps ? (outside ? 'partial' : 'inside') : 'outside';
}

export const placementLabels = {
  inside: 'Inside terrain',
  partial: 'Partly outside terrain',
  outside: 'Outside terrain',
};

/** Geographic extent constructors and editing transforms. */
import type { Vertex } from './polygon';
/** Available extent editing modes. */
export type Shape = 'freeform' | 'spline' | 'square' | 'rectangle' | 'circle';
const metersPerDegree = 111319.490793;
/** Create a local meter-based frame around geographic vertices. */
export function localFrame(points: Vertex[]) {
  const center: Vertex = [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ];
  const xScale = metersPerDegree * Math.cos((center[1] * Math.PI) / 180);
  return {
    center,
    toXY: (p: Vertex): Vertex => [
      (p[0] - center[0]) * xScale,
      (p[1] - center[1]) * metersPerDegree,
    ],
    toGeo: (p: Vertex): Vertex => [center[0] + p[0] / xScale, center[1] + p[1] / metersPerDegree],
  };
}
/** Rotate geographic vertices clockwise around their centroid. */
export function rotatePolygon(points: Vertex[], angleDegrees: number): Vertex[] {
  if (!points.length) return [];
  const frame = localFrame(points),
    a = (-angleDegrees * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return points.map(p => {
    const [x, y] = frame.toXY(p);
    return frame.toGeo([x * c - y * s, x * s + y * c]);
  });
}
/** Construct a square, rectangle, or circle from meter dimensions. */
export function regularShape(
  shape: Exclude<Shape, 'freeform' | 'spline'>,
  center: Vertex,
  widthM: number,
  heightM: number,
  angleDegrees: number,
): Vertex[] {
  if (!Number.isFinite(widthM) || !Number.isFinite(heightM) || widthM <= 0 || heightM <= 0)
    throw new Error('Shape dimensions must be positive.');
  const frame = localFrame([center]);
  let xy: Vertex[];
  if (shape === 'circle')
    xy = Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      return [(Math.cos(a) * widthM) / 2, (Math.sin(a) * widthM) / 2];
    });
  else {
    const w = widthM / 2,
      h = (shape === 'square' ? widthM : heightM) / 2;
    xy = [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ];
  }
  return rotatePolygon(xy.map(frame.toGeo), angleDegrees);
}
/** Circular fillets in ground meters, clamped locally so neighboring corners cannot overlap. */
export function roundPolygon(points: Vertex[], radiusM: number): Vertex[] {
  if (!Number.isFinite(radiusM) || radiusM < 0)
    throw new Error('Corner radius must be zero or greater.');
  if (!radiusM || points.length < 3) return structuredClone(points);
  const frame = localFrame(points),
    xy = points.map(frame.toXY),
    out: Vertex[] = [];
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i],
      prev = xy[(i + xy.length - 1) % xy.length],
      next = xy[(i + 1) % xy.length];
    const a = Math.hypot(p[0] - prev[0], p[1] - prev[1]),
      b = Math.hypot(next[0] - p[0], next[1] - p[1]);
    if (a < 1e-8 || b < 1e-8) continue;
    const u: Vertex = [(p[0] - prev[0]) / a, (p[1] - prev[1]) / a],
      v: Vertex = [(next[0] - p[0]) / b, (next[1] - p[1]) / b];
    const turn = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
    if (Math.abs(turn) < 1e-5) {
      out.push(p);
      continue;
    }
    const tangent = Math.min(radiusM * Math.tan(Math.abs(turn) / 2), a * 0.45, b * 0.45),
      r = tangent / Math.tan(Math.abs(turn) / 2),
      sign = Math.sign(turn);
    const start: Vertex = [p[0] - u[0] * tangent, p[1] - u[1] * tangent],
      center: Vertex = [start[0] - u[1] * sign * r, start[1] + u[0] * sign * r];
    const angle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const steps = Math.max(
      1,
      Math.min(Math.ceil(Math.abs(turn) / (Math.PI / 18)), Math.floor(480 / points.length) - 1),
    );
    for (let j = 0; j <= steps; j++) {
      const theta = angle + (turn * j) / steps;
      out.push([center[0] + r * Math.cos(theta), center[1] + r * Math.sin(theta)]);
    }
  }
  return out.map(frame.toGeo);
}
/** Serializable state needed to resume shape editing. */
export interface ExtentEditorState {
  shape: Shape;
  points: Vertex[];
  center: Vertex;
  width_m: number;
  height_m: number;
  angle_deg: number;
  corner_radius_m: number;
}

/** Closed Catmull–Rom curve through editable control points. */
export function splinePolygon(points: Vertex[]): Vertex[] {
  if (points.length < 3) return structuredClone(points);
  const frame = localFrame(points),
    p = points.map(frame.toXY),
    out: Vertex[] = [],
    steps = Math.max(1, Math.min(16, Math.floor(480 / p.length)));
  for (let i = 0; i < p.length; i++) {
    const a = p[(i + p.length - 1) % p.length],
      b = p[i],
      c = p[(i + 1) % p.length],
      d = p[(i + 2) % p.length];
    for (let j = 0; j < steps; j++) {
      const t = j / steps,
        t2 = t * t,
        t3 = t2 * t;
      out.push(
        [0, 1].map(
          k =>
            0.5 *
            (2 * b[k] +
              (-a[k] + c[k]) * t +
              (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
              (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3),
        ) as Vertex,
      );
    }
  }
  return out.map(frame.toGeo);
}

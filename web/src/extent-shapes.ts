/** Geographic extent constructors and editing transforms. */
import type { Vertex } from './polygon';
/** Available extent editing modes. */
export type Shape = 'freeform' | 'spline' | 'square' | 'rectangle' | 'circle';
const metersPerDegree = 111319.490793;
/** Maximum printed deviation between a rounded boundary and its polygonal approximation. */
export const boundaryChordErrorMm = 0.05;
const maxRoundedBoundaryVertices = 480;

/** Controls for converting geographic corner arcs to printable line segments. */
export interface BoundarySamplingOptions {
  max_print_size_mm?: [number, number];
  chord_error_mm?: number;
  max_vertices?: number;
}
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
interface PointCorner {
  kind: 'point';
  point: Vertex;
}
interface ArcCorner {
  kind: 'arc';
  center: Vertex;
  radius_m: number;
  start_angle_rad: number;
  turn_rad: number;
  steps: number;
}
type Corner = PointCorner | ArcCorner;

function fitScaleMmPerM(bounds: [number, number, number, number], bed: [number, number]) {
  const width = bounds[2] - bounds[0],
    depth = bounds[3] - bounds[1];
  if (!bed.every(value => Number.isFinite(value) && value > 0) || width <= 0 || depth <= 0)
    throw new Error('Print dimensions and terrain extent must be positive.');
  const unrotated = Math.min(bed[0] / width, bed[1] / depth),
    rotated = Math.min(bed[0] / depth, bed[1] / width);
  return Math.max(unrotated, rotated);
}

function onArc(angle: number, start: number, turn: number) {
  const tau = Math.PI * 2,
    distance = turn > 0 ? (angle - start + tau) % tau : (start - angle + tau) % tau;
  return distance <= Math.abs(turn) + 1e-12;
}

/** Return the exact local-meter bounds of points and circular arcs. */
function cornerBounds(corners: Corner[]): [number, number, number, number] {
  const bounds: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const include = ([x, y]: Vertex) => {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  };
  for (const corner of corners) {
    if (corner.kind === 'point') {
      include(corner.point);
      continue;
    }
    for (const angle of [
      corner.start_angle_rad,
      corner.start_angle_rad + corner.turn_rad,
      0,
      Math.PI / 2,
      Math.PI,
      (Math.PI * 3) / 2,
    ])
      if (
        angle === corner.start_angle_rad ||
        angle === corner.start_angle_rad + corner.turn_rad ||
        onArc(angle, corner.start_angle_rad, corner.turn_rad)
      )
        include([
          corner.center[0] + corner.radius_m * Math.cos(angle),
          corner.center[1] + corner.radius_m * Math.sin(angle),
        ]);
  }
  return bounds;
}

/** Fit requested arc steps into the serialized boundary's vertex budget. */
function limitArcSteps(corners: Corner[], maxVertices: number) {
  const arcs = corners.filter((corner): corner is ArcCorner => corner.kind === 'arc'),
    pointCount = corners.length - arcs.length,
    minimumVertices = pointCount + arcs.length * 2;
  if (minimumVertices > maxVertices)
    throw new Error(
      'This rounded outline has too many control points. Reduce them or use no radius.',
    );
  const requestedExtra = arcs.reduce((sum, arc) => sum + arc.steps - 1, 0),
    availableExtra = maxVertices - minimumVertices;
  if (requestedExtra <= availableExtra) return;
  const factor = availableExtra / requestedExtra,
    allocations = arcs.map((arc, index) => {
      const exact = (arc.steps - 1) * factor,
        extra = Math.floor(exact);
      arc.steps = 1 + extra;
      return { arc, index, remainder: exact - extra };
    });
  let remaining = availableExtra - allocations.reduce((sum, item) => sum + item.arc.steps - 1, 0);
  allocations
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(item => {
      if (remaining > 0) {
        item.arc.steps++;
        remaining--;
      }
    });
}

/**
 * Circular fillets in ground meters, clamped locally so neighboring corners cannot overlap.
 * Arc density adapts to final print scale so chord error remains visually consistent.
 */
export function roundPolygon(
  points: Vertex[],
  radiusM: number,
  options: BoundarySamplingOptions = {},
): Vertex[] {
  if (!Number.isFinite(radiusM) || radiusM < 0)
    throw new Error('Corner radius must be zero or greater.');
  if (!radiusM || points.length < 3) return structuredClone(points);
  const frame = localFrame(points),
    xy = points.map(frame.toXY),
    corners: Corner[] = [];
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
      corners.push({ kind: 'point', point: p });
      continue;
    }
    const tangent = Math.min(radiusM * Math.tan(Math.abs(turn) / 2), a * 0.45, b * 0.45),
      r = tangent / Math.tan(Math.abs(turn) / 2),
      sign = Math.sign(turn);
    const start: Vertex = [p[0] - u[0] * tangent, p[1] - u[1] * tangent],
      center: Vertex = [start[0] - u[1] * sign * r, start[1] + u[0] * sign * r];
    corners.push({
      kind: 'arc',
      center,
      radius_m: r,
      start_angle_rad: Math.atan2(start[1] - center[1], start[0] - center[0]),
      turn_rad: turn,
      steps: 1,
    });
  }
  const chordErrorMm = options.chord_error_mm ?? boundaryChordErrorMm,
    maxVertices = Math.min(500, Math.max(3, options.max_vertices ?? maxRoundedBoundaryVertices)),
    scale = fitScaleMmPerM(cornerBounds(corners), options.max_print_size_mm ?? [248, 198]);
  if (!Number.isFinite(chordErrorMm) || chordErrorMm <= 0)
    throw new Error('Boundary chord error must be positive.');
  for (const corner of corners) {
    if (corner.kind !== 'arc') continue;
    const printedRadiusMm = corner.radius_m * scale,
      maxStep =
        chordErrorMm >= printedRadiusMm
          ? Math.PI
          : 2 * Math.acos(1 - chordErrorMm / printedRadiusMm);
    corner.steps = Math.max(1, Math.ceil(Math.abs(corner.turn_rad) / maxStep));
  }
  limitArcSteps(corners, maxVertices);
  const out: Vertex[] = [];
  for (const corner of corners) {
    if (corner.kind === 'point') {
      out.push(corner.point);
      continue;
    }
    for (let j = 0; j <= corner.steps; j++) {
      const theta = corner.start_angle_rad + (corner.turn_rad * j) / corner.steps;
      out.push([
        corner.center[0] + corner.radius_m * Math.cos(theta),
        corner.center[1] + corner.radius_m * Math.sin(theta),
      ]);
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

/** Reconstruct the printable boundary represented by an extent editor state. */
export function extentPolygon(
  state: ExtentEditorState,
  maxPrintSizeMm: [number, number],
): Vertex[] {
  const rotated = rotatePolygon(state.points, state.shape === 'circle' ? 0 : state.angle_deg),
    rounded =
      state.shape === 'circle' || state.shape === 'spline'
        ? rotated
        : roundPolygon(rotated, state.corner_radius_m, { max_print_size_mm: maxPrintSizeMm });
  return state.shape === 'spline' ? splinePolygon(rounded) : rounded;
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

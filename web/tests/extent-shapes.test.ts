import { it, expect } from 'vitest';
import {
  localFrame,
  regularShape,
  rotatePolygon,
  roundPolygon,
  splinePolygon,
} from '../src/extent-shapes';
import { validatePolygon } from '../src/polygon';
it('constructs metric squares and rectangles at latitude', () => {
  for (const lat of [0, 45, 70]) {
    const p = regularShape('rectangle', [12, lat], 2000, 1000, 0);
    const f = localFrame(p),
      q = p.map(f.toXY);
    expect(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])).toBeCloseTo(2000, 5);
    expect(Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])).toBeCloseTo(1000, 5);
  }
});
it('rotates without changing side lengths', () => {
  const p = regularShape('square', [12, 45], 1000, 800, 45),
    q = p.map(localFrame(p).toXY);
  expect(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1])).toBeCloseTo(1000, 4);
  expect(() => validatePolygon(p)).not.toThrow();
});
it('adapts rounded-corner density to print scale and chord error', () => {
  const p = regularShape('square', [12, 45], 1000, 1000, 0),
    rounded = roundPolygon(p, 100),
    largerPrint = roundPolygon(p, 100, { max_print_size_mm: [496, 396] });
  expect(rounded).toHaveLength(52);
  expect(largerPrint.length).toBeGreaterThan(rounded.length);
  const frame = localFrame(p),
    local = rounded.map(frame.toXY),
    pointsPerCorner = rounded.length / 4,
    scaleMmPerM = 198 / 1000;
  for (let corner = 0; corner < 4; corner++) {
    const arc = local.slice(corner * pointsPerCorner, (corner + 1) * pointsPerCorner);
    for (let i = 1; i < arc.length; i++) {
      const chordM = Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1]),
        sagittaMm = (100 - Math.sqrt(100 ** 2 - (chordM / 2) ** 2)) * scaleMmPerM;
      expect(sagittaMm).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  }
  expect(roundPolygon(p, 0)).toEqual(p);
  expect(() => validatePolygon(roundPolygon(p, 10000))).not.toThrow();
  const c: [number, number][] = [
    [0, 0],
    [0.01, 0],
    [0.005, 0.005],
    [0.01, 0.01],
    [0, 0.01],
  ];
  expect(() => validatePolygon(roundPolygon(c, 50))).not.toThrow();
});
it('makes a circle with a constant ground radius', () => {
  const p = regularShape('circle', [12, 45], 1000, 1000, 0),
    q = p.map(localFrame(p).toXY);
  expect(q).toHaveLength(96);
  q.forEach(([x, y]) => expect(Math.hypot(x, y)).toBeCloseTo(500, 5));
});

it('creates a valid closed spline that passes through every editable control point', () => {
  const controls: [number, number][] = [
    [-121.67, 45.68],
    [-121.65, 45.68],
    [-121.645, 45.695],
    [-121.66, 45.705],
    [-121.675, 45.695],
  ];
  const spline = splinePolygon(controls);
  expect(spline.length).toBeGreaterThan(controls.length * 4);
  const stride = spline.length / controls.length;
  controls.forEach((control, index) => {
    expect(spline[index * stride][0]).toBeCloseTo(control[0], 10);
    expect(spline[index * stride][1]).toBeCloseTo(control[1], 10);
  });
  expect(() => validatePolygon(spline)).not.toThrow();
});

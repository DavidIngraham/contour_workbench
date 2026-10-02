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
it('rounds convex and concave outlines and handles oversized radius', () => {
  const p = regularShape('square', [12, 45], 1000, 1000, 0);
  expect(roundPolygon(p, 100)).toHaveLength(40);
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

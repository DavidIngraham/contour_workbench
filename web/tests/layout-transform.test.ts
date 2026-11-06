import { expect, it } from 'vitest';
import { modelXY, modelLonLat } from '../src/layout-transform';
import type { Layout } from '../src/types';

it('matches the rotated geographic axes and round-trips off-origin coordinates', () => {
  const layout: Layout = {
    bounds: [5, 40, 5.01, 40.01],
    width: 120,
    depth: 90,
    scale: 0.1,
    rotation_deg: 37,
    offset_m: [-500, 0],
    rotated: false,
    minimum: 0,
    height_factor: 1,
    base_height: 2,
  };
  const origin = modelXY(layout, [5, 40]);
  expect(origin).toEqual([50, 0]);
  const north = modelXY(layout, [5, 40.001]);
  expect(north[0]).toBeLessThan(origin[0]);
  expect(north[1]).toBeGreaterThan(origin[1]);
  for (const point of [
    [5, 40],
    [5.004, 40.003],
    [5.02, 39.99],
  ]) {
    const result = modelLonLat(layout, modelXY(layout, point));
    expect(result[0]).toBeCloseTo(point[0], 12);
    expect(result[1]).toBeCloseTo(point[1], 12);
  }
});

it('preserves legacy 90-degree layouts', () => {
  const layout: Layout = {
    bounds: [0, 0, 1, 1],
    width: 100,
    depth: 80,
    scale: 1,
    rotated: true,
    minimum: 0,
    height_factor: 1,
    base_height: 2,
  };
  expect(modelXY(layout, [0.25, 0.75])).toEqual([25, 20]);
  expect(modelLonLat(layout, [25, 20])).toEqual([0.25, 0.75]);
});

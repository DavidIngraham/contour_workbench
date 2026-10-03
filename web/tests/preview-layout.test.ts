import { describe, expect, it } from 'vitest';
import { previewBoundary, previewLayout } from '../src/preview-layout';
import { defaults } from '../src/types';

describe('progressive preview layout', () => {
  it('fills the bed using the same rotated geographic mapping as terrain', () => {
    const bounds: [number, number, number, number] = [-121.7, 45.6, -121.69, 45.64],
      layout = previewLayout(bounds, defaults),
      boundary = previewBoundary(layout, [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ]);

    expect(layout.rotated).toBe(true);
    expect(Math.max(layout.width, layout.depth)).toBeCloseTo(defaults.max_print_size_mm[0]);
    expect(boundary[0]).toEqual([layout.width, 0]);
    expect(boundary[1][0]).toBeCloseTo(0);
    expect(boundary[1][1]).toBeCloseTo(layout.depth);
  });
});

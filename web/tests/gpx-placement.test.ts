import { describe, expect, it } from 'vitest';
import { gpxPlacement } from '../src/gpx-placement';
import type { Feature } from '../src/types';
const feature = (lines: [number, number][][]): Feature => ({
  id: 'gpx:test',
  name: 'Track',
  class: 'trail',
  lines,
  enabled: true,
  tags: {},
});
describe('GPX footprint feedback', () => {
  it('distinguishes contained, missing and crossing tracks even with endpoints outside', () => {
    expect(
      gpxPlacement(
        feature([
          [
            [1, 1],
            [9, 9],
          ],
        ]),
        [0, 0, 10, 10],
      ),
    ).toBe('inside');
    expect(
      gpxPlacement(
        feature([
          [
            [-5, -5],
            [-1, -1],
          ],
        ]),
        [0, 0, 10, 10],
      ),
    ).toBe('outside');
    expect(
      gpxPlacement(
        feature([
          [
            [-5, 5],
            [15, 5],
          ],
        ]),
        [0, 0, 10, 10],
      ),
    ).toBe('partial');
  });
  it('detects concave gaps between interior endpoints and preserves disconnected segments', () => {
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [7, 3],
      [3, 3],
      [3, 10],
      [0, 10],
    ];
    expect(
      gpxPlacement(
        feature([
          [
            [1, 8],
            [9, 8],
          ],
        ]),
        [0, 0, 10, 10],
        ring,
      ),
    ).toBe('partial');
    expect(
      gpxPlacement(
        feature([
          [
            [1, 8],
            [2, 8],
          ],
          [
            [8, 8],
            [9, 8],
          ],
        ]),
        [0, 0, 10, 10],
        ring,
      ),
    ).toBe('inside');
    expect(
      gpxPlacement(
        feature([
          [
            [4, 8],
            [6, 8],
          ],
        ]),
        [0, 0, 10, 10],
        ring,
      ),
    ).toBe('outside');
  });
});

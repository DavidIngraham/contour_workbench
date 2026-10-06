import { describe, expect, it } from 'vitest';
import { defaults, normalizeSettings, type Mesh, type Settings } from '../src/types';
import {
  boundaryFillGeometry,
  insetOpeningWall,
  insertPreviewState,
  perspectiveFitDistance,
  topViewFitDistance,
} from '../src/viewer';

const prism: Mesh = {
  positions: [0, 0, 1, 2, 0, 1, 2, 2, 1, 0, 2, 1, 0, 0, 0.5, 2, 0, 0.5, 2, 2, 0.5, 0, 2, 0.5],
  indices: [
    0, 1, 2, 0, 2, 3, 6, 5, 4, 7, 6, 4, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7,
    4, 3, 4, 0,
  ],
};

describe('insert relative height', () => {
  it('migrates legacy surface modes and removes their stale keys', () => {
    expect(normalizeSettings({ manufacturing_mode: 'separate' }).insert_relative_height_mm).toBe(
      0.35,
    );
    const proud = normalizeSettings({
      insert_surface_mode: 'proud',
      insert_proud_height_mm: 0.6,
      insert_inset_depth_mm: 0.2,
    });
    expect(proud.insert_relative_height_mm).toBe(0.6);
    expect(normalizeSettings({ insert_surface_mode: 'flush' }).insert_relative_height_mm).toBe(0);
    expect(
      normalizeSettings({
        insert_surface_mode: 'inset',
        insert_inset_depth_mm: 0.45,
      }).insert_relative_height_mm,
    ).toBe(-0.45);
    expect(proud).not.toHaveProperty('insert_surface_mode');
    expect(proud).not.toHaveProperty('insert_proud_height_mm');
    expect(proud).not.toHaveProperty('insert_inset_depth_mm');
  });

  it('round-trips the canonical signed height and gives it migration precedence', () => {
    const inset: Settings = { ...defaults, insert_relative_height_mm: -0.45 };
    const restored = normalizeSettings(
      JSON.parse(
        JSON.stringify({
          ...inset,
          insert_surface_mode: 'proud',
          insert_proud_height_mm: 2,
        }),
      ),
    );
    expect(restored).toEqual(inset);
    expect(JSON.stringify(restored)).not.toContain('insert_surface_mode');
  });

  it('infers render-only flush bias and inset opening walls from the sign', () => {
    const original = [...prism.positions];
    expect(insertPreviewState(0, 0.009)).toEqual({
      renderBiasMm: 0.009,
      opensTerrain: false,
      openingDepthMm: 0,
    });
    expect(insertPreviewState(0.35, 0.009)).toEqual({
      renderBiasMm: 0.009,
      opensTerrain: false,
      openingDepthMm: 0,
    });

    const inset = insertPreviewState(-0.3, 0.009);
    expect(inset).toEqual({
      renderBiasMm: 0,
      opensTerrain: true,
      openingDepthMm: 0.3,
    });
    const walls = insetOpeningWall(prism, inset.openingDepthMm);
    expect(walls.indices).toHaveLength(24);
    expect(Math.max(...walls.positions.filter((_, index) => index % 3 === 2))).toBeCloseTo(1.3);
    expect(prism.positions).toEqual(original);
  });
});

describe('preview framing', () => {
  it('backs the camera up enough for narrow viewports', () => {
    expect(topViewFitDistance(200, 100, 0.5, 35)).toBeGreaterThan(
      topViewFitDistance(200, 100, 2, 35),
    );
    expect(perspectiveFitDistance(100, 0.5, 35)).toBeGreaterThan(
      perspectiveFitDistance(100, 2, 35),
    );
  });

  it('builds a closed, elevated fill from an outline', () => {
    const geometry = boundaryFillGeometry(
      [
        [0, 0],
        [200, 0],
        [200, 100],
        [0, 100],
        [0, 0],
      ],
      0.2,
    );
    geometry.computeBoundingBox();

    expect(geometry.getAttribute('position').count).toBeGreaterThanOrEqual(4);
    expect(geometry.getIndex()?.count).toBe(6);
    expect(geometry.boundingBox?.min.toArray().slice(0, 2)).toEqual([0, 0]);
    expect(geometry.boundingBox?.max.toArray().slice(0, 2)).toEqual([200, 100]);
    expect(geometry.boundingBox?.min.z).toBeCloseTo(0.2);
    expect(geometry.boundingBox?.max.z).toBeCloseTo(0.2);
    geometry.dispose();
  });
});

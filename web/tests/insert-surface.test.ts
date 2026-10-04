import { describe, expect, it } from 'vitest';
import {
  defaults,
  insertSurfaceOffsetMm,
  normalizeSettings,
  type Mesh,
  type Settings,
} from '../src/types';
import { insetOpeningWall, insertPreviewState } from '../src/viewer';

const prism: Mesh = {
  positions: [0, 0, 1, 2, 0, 1, 2, 2, 1, 0, 2, 1, 0, 0, 0.5, 2, 0, 0.5, 2, 2, 0.5, 0, 2, 0.5],
  indices: [
    0, 1, 2, 0, 2, 3, 6, 5, 4, 7, 6, 4, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7,
    4, 3, 4, 0,
  ],
};

describe('insert surface placement', () => {
  it('migrates legacy settings to the backward-compatible proud placement', () => {
    const migrated = normalizeSettings({ manufacturing_mode: 'separate' });
    expect(migrated.insert_surface_mode).toBe('proud');
    expect(migrated.insert_proud_height_mm).toBe(0.35);
    expect(insertSurfaceOffsetMm(migrated)).toBe(0.35);
  });

  it('round-trips flush and inset configuration', () => {
    const inset: Settings = {
      ...defaults,
      insert_surface_mode: 'inset',
      insert_inset_depth_mm: 0.45,
    };
    const restored = normalizeSettings(JSON.parse(JSON.stringify(inset)));
    expect(restored).toEqual(inset);
    expect(insertSurfaceOffsetMm(restored)).toBe(-0.45);
    expect(insertSurfaceOffsetMm({ ...restored, insert_surface_mode: 'flush' })).toBe(0);
  });

  it('uses render-only flush bias and creates visible inset opening walls', () => {
    const original = [...prism.positions];
    const flush = insertPreviewState({ insert_surface_mode: 'flush' }, 0, 0.009);
    expect(flush).toEqual({
      renderBiasMm: 0.009,
      opensTerrain: false,
      openingDepthMm: 0,
    });

    const inset = insertPreviewState({ insert_surface_mode: 'inset' }, -0.3, 0.009);
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

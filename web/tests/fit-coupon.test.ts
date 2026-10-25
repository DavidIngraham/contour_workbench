import { describe, expect, it } from 'vitest';
import {
  couponLabels,
  couponLayout,
  defaultCouponOptions,
  validateCoupon,
} from '../src/fit-coupon';
import { defaults } from '../src/types';

describe('dimensioned fit coupon', () => {
  it('fits underside lettering inside the terrain footprint without a label extension', () => {
    for (const nozzle of [0.2, 0.4, 0.6, 0.8]) {
      const s = { ...defaults, nozzle_diameter_mm: nozzle, path_width_mm: nozzle * 2.25 };
      const layout = couponLayout(s, defaultCouponOptions(s));
      expect(layout.depthMm).toBe(layout.terrainDepthMm);
      expect((1 + 6 * 3.8 + 7 * 0.45) * layout.textScale).toBeLessThan(layout.depthMm);
      expect(layout.floorMm - layout.engravingDepthMm).toBeCloseTo(0.6);
    }
    expect(couponLayout(defaults, defaultCouponOptions(defaults)).depthMm).toBe(28);
  });
  it('adds floor thickness without changing pocket engagement or clearance', () => {
    const options = defaultCouponOptions(defaults);
    const before = couponLayout(defaults, options);
    const thicker = { ...options, floor_thickness_mm: 5 };
    const after = couponLayout(defaults, thicker);
    expect(after.surfaceMm - after.floorMm).toBe(before.surfaceMm - before.floorMm);
    expect(after.surfaceMm - before.surfaceMm).toBe(4);
    expect(couponLabels(defaults, thicker).pockets).toEqual(
      couponLabels(defaults, options).pockets,
    );
    expect(couponLabels(defaults, thicker).settings.join(' ')).toContain('FLOOR 5.00 MM');
    for (const floor_thickness_mm of [NaN, Infinity, 0, -1, 20.01, 1.001])
      expect(() => validateCoupon(defaults, { ...options, floor_thickness_mm })).toThrow(
        'base thickness',
      );
  });
  it('repeats four equal terrain tiles with minimum insert thickness below the relief', () => {
    const layout = couponLayout(defaults, defaultCouponOptions(defaults));
    expect(layout.tileWidthMm * 4).toBe(layout.widthMm);
    expect(layout.pocketCentersMm).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(layout.surfaceMm - layout.floorMm).toBe(defaults.insert_depth_mm);
    expect(layout.reliefMm).toBe(4);
    expect(layout.totalHeightMm).toBe(layout.surfaceMm + layout.reliefMm);
    const labels = couponLabels(defaults, defaultCouponOptions(defaults)).settings.join(' ');
    expect(labels).toContain('MIN INSERT 2.00 MM');
    expect(labels).toContain('RELIEF 4.00 MM');
  });
  it('keeps clearance trials distinct even for a zero-clearance starting project', () => {
    const s = { ...defaults, insert_fit_clearance_per_side_mm: 0 };
    const options = defaultCouponOptions(s);
    expect(new Set(options.clearances_mm).size).toBe(4);
    expect(() => validateCoupon(s, options)).not.toThrow();
  });
  it('grows coupon and insert height together with a fixed floor and unchanged taper', () => {
    const options = defaultCouponOptions(defaults);
    const reference = couponLayout(defaults, options);
    const taperLabel = couponLabels(defaults, options).settings.find(s => s.startsWith('DRAFT'));
    for (const depth of [2.5, 3, 5, 10, 20]) {
      const settings = { ...defaults, insert_depth_mm: depth };
      expect(() => validateCoupon(settings, options)).not.toThrow();
      const layout = couponLayout(settings, options);
      expect(layout.floorMm).toBe(reference.floorMm);
      expect(layout.surfaceMm - reference.surfaceMm).toBeCloseTo(depth - defaults.insert_depth_mm);
      expect(couponLabels(settings, options).settings.find(s => s.startsWith('DRAFT'))).toBe(
        taperLabel,
      );
    }
    const settings = { ...defaults, insert_depth_mm: 5 };
    expect(() => validateCoupon(settings, { ...options, floor_thickness_mm: 5 })).not.toThrow();
  });
  it('labels geometry values in units and rejects rounding or silently clamped taper', () => {
    const options = defaultCouponOptions(defaults);
    expect(couponLabels(defaults, options).pockets).toEqual([
      '0.10 MM',
      '0.15 MM',
      '0.20 MM',
      '0.25 MM',
    ]);
    for (const settings of [
      { ...defaults, path_width_mm: NaN },
      { ...defaults, path_width_mm: 0.901 },
      { ...defaults, insert_draft_angle_deg: 10 },
      { ...defaults, insert_elephant_foot_height_mm: 0 },
      { ...defaults, insert_draft_height_mm: 0 },
      { ...defaults, insert_draft_height_mm: NaN },
    ])
      expect(() => validateCoupon(settings, options)).toThrow();
    for (const values of [
      [0.1, 0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3, 1.01],
    ])
      expect(() => validateCoupon(defaults, { clearances_mm: values })).toThrow();
  });
  it('leaves terrain walls between wider switchbacks and scales printable lettering', () => {
    const settings = { ...defaults, nozzle_diameter_mm: 0.8, path_width_mm: 3 };
    const options = { clearances_mm: [0, 0.3, 0.6, 1] };
    validateCoupon(settings, options);
    const layout = couponLayout(settings, options);
    expect(2.4 * layout.pathScale - 5).toBeCloseTo(0.6);
    expect(0.45 * layout.textScale).toBeGreaterThanOrEqual(settings.nozzle_diameter_mm);
    for (const label of couponLabels(settings, options).settings)
      expect((label.length * 6 - 1) * 0.45 * layout.textScale + 8 * layout.textScale).toBeLessThan(
        layout.widthMm,
      );
  });
});

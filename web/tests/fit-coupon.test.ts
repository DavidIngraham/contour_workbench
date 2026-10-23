import { describe, expect, it } from 'vitest';
import {
  couponLabels,
  couponLayout,
  defaultCouponOptions,
  validateCoupon,
} from '../src/fit-coupon';
import { defaults } from '../src/types';

describe('dimensioned fit coupon', () => {
  it('keeps clearance trials distinct even for a zero-clearance starting project', () => {
    const s = { ...defaults, insert_fit_clearance_per_side_mm: 0 };
    const options = defaultCouponOptions(s);
    expect(new Set(options.clearances_mm).size).toBe(4);
    expect(() => validateCoupon(s, options)).not.toThrow();
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

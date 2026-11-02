import { describe, expect, it } from 'vitest';
import { orcaAssemblyLayout } from '../src/orca-layout';

const mini = {
  name: 'A1 mini',
  widthMm: 180,
  depthMm: 180,
  heightMm: 180,
  keepouts: [[67, -5, 116, 1]] as const,
};

describe('Orca painted assembly placement', () => {
  it.each([0.2, 0.4, 0.6, 0.8])(
    'keeps a %s mm painted coupon, brims and tower within the small bed',
    nozzle => {
      const layout = orcaAssemblyLayout([60, 42, 2.75], mini, nozzle, true);
      expect(layout.originMm[0]).toBeGreaterThanOrEqual(1);
      expect(layout.originMm[1]).toBeGreaterThanOrEqual(1);
      expect(layout.tower!.originMm[0] + layout.tower!.sizeMm[0] + 4).toBeLessThanOrEqual(180);
      expect(layout.tower!.originMm[1]).toBeGreaterThanOrEqual(4);
      expect(layout.originMm[0] + 60 + 1).toBeLessThanOrEqual(layout.tower!.originMm[0] - 4);
    },
  );

  it('rejects a painted model that leaves no room for its tower instead of shrinking it', () => {
    expect(() => orcaAssemblyLayout([170, 170, 5], mini, 0.4, true)).toThrow(/does not fit/);
    expect(() => orcaAssemblyLayout([60, 42, 181], mini, 0.4, true)).toThrow(/print height/);
  });

  it('preserves space for an explicit manual single-color assembly without a tower', () => {
    const layout = orcaAssemblyLayout([160, 160, 5], mini, 0.4, false);
    expect(layout.originMm).toEqual([1, 2]);
    expect(layout.tower).toBeUndefined();
  });

  it('fits a full Post Canyon terrain by widening its tower into the remaining rear strip', () => {
    const layout = orcaAssemblyLayout(
      [248, 198, 10],
      {
        name: 'P1S',
        widthMm: 256,
        depthMm: 256,
        heightMm: 256,
        keepouts: [
          [0, 0, 18, 28],
          [17, 0, 241, 16],
        ],
      },
      0.4,
      true,
    );
    expect(layout.tower!.sizeMm[0]).toBeGreaterThan(35);
    expect(layout.originMm[1] + 198 + 1).toBeLessThanOrEqual(layout.tower!.originMm[1] - 4);
  });
});

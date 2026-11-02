import { beforeAll, expect, it } from 'vitest';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import { supportsExtrusion } from '../src/insert-taper';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await Module();
  M.setup();
});

it('rejects a valid but unprintably narrow base and accepts reduced relief on a clipped path', () => {
  const seatingWidthMm = 0.55;
  const extrusionWidthMm = 0.45;
  const footprint = M.CrossSection.square([seatingWidthMm, 8]);
  const fullRelief = footprint.offset(-0.18, 'Round', 2, 16);
  const reducedRelief = footprint.offset(-0.045, 'Round', 2, 16);
  try {
    expect(fullRelief.isEmpty()).toBe(false);
    expect(supportsExtrusion(fullRelief, extrusionWidthMm)).toBe(false);
    expect(supportsExtrusion(reducedRelief, extrusionWidthMm)).toBe(true);
    expect(supportsExtrusion(footprint, extrusionWidthMm)).toBe(true);
    expect(footprint.area()).toBeCloseTo(seatingWidthMm * 8);
  } finally {
    reducedRelief.delete();
    fullRelief.delete();
    footprint.delete();
  }
});

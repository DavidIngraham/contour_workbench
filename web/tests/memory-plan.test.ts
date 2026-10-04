import { describe, expect, it } from 'vitest';
import { browserBuildMemoryBudgetMb, finalBuildMemoryPlan } from '../src/memory-plan';

describe('final build memory preflight', () => {
  it('keeps full detail when the estimate fits and respects explicit detail choices', () => {
    expect(finalBuildMemoryPlan(10_000, 20_000, 5, 0, 512).adapted).toBe(false);
    const explicit = finalBuildMemoryPlan(2_000_000, 4_000_000, 200, 0.1, 256);
    expect(explicit.adapted).toBe(false);
    expect(explicit.terrainMaxErrorMm).toBe(0.1);
  });

  it('selects a bounded tolerance before a giant full-detail allocation', () => {
    const plan = finalBuildMemoryPlan(2_000_000, 4_000_000, 200, 0, 256);
    expect(plan.adapted).toBe(true);
    expect(plan.estimatedPeakMb).toBeGreaterThan(plan.budgetMb);
    expect(plan.terrainMaxErrorMm).toBeGreaterThanOrEqual(0.02);
    expect(plan.terrainMaxErrorMm).toBeLessThanOrEqual(0.25);
  });

  it('caps browser budgets across low and high memory hints', () => {
    expect(browserBuildMemoryBudgetMb(1, 256 * 1024 * 1024)).toBe(160);
    expect(browserBuildMemoryBudgetMb(64, 16 * 1024 * 1024 * 1024)).toBe(768);
  });
});

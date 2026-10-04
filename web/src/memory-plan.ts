/** Conservative final-build memory preflight independent of the interactive preview. */
export interface FinalBuildMemoryPlan {
  budgetMb: number;
  estimatedPeakMb: number;
  terrainMaxErrorMm: number;
  adapted: boolean;
}

/** Derive a conservative working-set budget from browser device and heap hints. */
export function browserBuildMemoryBudgetMb(
  deviceMemoryGb = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 4,
  heapLimitBytes = Number(
    (performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory
      ?.jsHeapSizeLimit,
  ),
) {
  const deviceBudget = deviceMemoryGb * 1024 * 0.12;
  const heapBudget = heapLimitBytes > 0 ? (heapLimitBytes / 1024 / 1024) * 0.35 : Infinity;
  return Math.round(Math.max(160, Math.min(768, deviceBudget, heapBudget)));
}

/** Estimate final-build pressure and select bounded adaptive detail before allocating geometry. */
export function finalBuildMemoryPlan(
  sourceSamples: number,
  previewTriangles: number,
  enabledFeatures: number,
  requestedErrorMm: number,
  budgetMb: number,
): FinalBuildMemoryPlan {
  const estimatedPeakMb =
    (sourceSamples * 512 + previewTriangles * 256 + enabledFeatures * 768 * 1024) / 1024 / 1024;
  if (requestedErrorMm > 0 || estimatedPeakMb <= budgetMb * 0.72)
    return {
      budgetMb,
      estimatedPeakMb,
      terrainMaxErrorMm: requestedErrorMm,
      adapted: false,
    };
  const pressure = estimatedPeakMb / Math.max(1, budgetMb * 0.72);
  const terrainMaxErrorMm = Math.min(0.25, Math.max(0.02, 0.02 * Math.sqrt(pressure)));
  return {
    budgetMb,
    estimatedPeakMb,
    terrainMaxErrorMm: Math.round(terrainMaxErrorMm * 1000) / 1000,
    adapted: true,
  };
}

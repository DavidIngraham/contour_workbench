/** Defensive Manifold cross-section inset helpers used by tapered inserts. */
/** Minimal owned WASM cross-section interface needed by taper generation. */
export interface CrossSectionLike<T> {
  offset(delta: number, joinType: 'Round', miterLimit: number, circularSegments: number): T;
  isEmpty(): boolean;
  delete(): void;
}

/** Retry a requested inset at smaller values without deleting the caller-owned section. */
export function insetCrossSection<T extends CrossSectionLike<T>>(
  section: T,
  insetMm: number,
  maxRetries = 8,
): { cross: T; owned: boolean; insetMm: number } {
  let attempt = insetMm;
  for (let retry = 0; attempt > 1e-6 && retry < maxRetries; retry++) {
    const candidate = section.offset(-attempt, 'Round', 2, 16);
    if (!candidate.isEmpty()) return { cross: candidate, owned: true, insetMm: attempt };
    candidate.delete();
    attempt *= 0.5;
  }
  return { cross: section, owned: false, insetMm: 0 };
}
/** Complexity ceiling above which tapering is skipped to keep generation interactive. */
export const maxTaperTriangles = 10_000;
/** Return whether an insert is small enough for stepped taper booleans. */
export function shouldTaperInsert(indexCount: number) {
  return indexCount / 3 <= maxTaperTriangles;
}

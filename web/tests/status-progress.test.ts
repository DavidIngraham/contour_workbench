import { describe, expect, it } from 'vitest';
import { resolveStatusProgress } from '../src/status-progress';

describe('status progress', () => {
  it('uses structured worker progress', () => {
    expect(resolveStatusProgress('Preparing pieces…', 2, 5)).toEqual({
      completed: 2,
      total: 5,
      percent: 40,
    });
  });

  it('recognizes m of n messages', () => {
    expect(resolveStatusProgress('Downloading terrain data… 3 of 4')).toEqual({
      completed: 3,
      total: 4,
      percent: 75,
    });
  });

  it('clamps invalid ranges and ignores messages without a total', () => {
    expect(resolveStatusProgress('Preparing…', 8, 4)?.percent).toBe(100);
    expect(resolveStatusProgress('Preparing…')).toBeUndefined();
  });
});

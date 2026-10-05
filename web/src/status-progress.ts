/** Normalized progress values suitable for an accessible progress bar. */
export interface StatusProgress {
  completed: number;
  total: number;
  percent: number;
}

/** Prefer structured progress, then recognize user-facing “m of n” text. */
export function resolveStatusProgress(
  message: string,
  completed?: number,
  total?: number,
): StatusProgress | undefined {
  let current = completed;
  let count = total;
  if (!Number.isFinite(current) || !Number.isFinite(count)) {
    const match = message.match(/\b(\d+)\s+of\s+(\d+)\b/i);
    if (match) {
      current = Number(match[1]);
      count = Number(match[2]);
    }
  }
  if (!Number.isFinite(current) || !Number.isFinite(count) || count! <= 0) return undefined;
  const normalizedTotal = Math.max(1, count!);
  const normalizedCompleted = Math.max(0, Math.min(normalizedTotal, current!));
  return {
    completed: normalizedCompleted,
    total: normalizedTotal,
    percent: Math.round((normalizedCompleted / normalizedTotal) * 100),
  };
}

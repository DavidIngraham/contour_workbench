interface Printer {
  name: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  keepouts: readonly (readonly [number, number, number, number])[];
}
type Rect = readonly [number, number, number, number];
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Place the complete painted assembly and its stock prime tower on one native bed.
 * The common translation preserves all part/painting coordinates relative to one another.
 */
export function orcaAssemblyLayout(
  sizeMm: readonly [number, number, number],
  printer: Printer,
  nozzleMm: number,
  tower: boolean,
) {
  // A painted terrain assembly has a broad supported base and uses no object brim.
  const margin = 1;
  // Try wider towers when a large terrain leaves only a shallow strip behind it.
  // Reserve four stock 45 mm³ primes at the thinnest layer, plus tower walls.
  const towerSizes = tower
    ? [...new Set([35, 70, 105, 140, 175, 210, printer.widthMm - 8])]
        .filter(width => width <= printer.widthMm - 8)
        .map(
          width =>
            [
              width,
              Math.max(15, Math.ceil(180 / Math.max(0.04, nozzleMm * 0.175) / width) + 6),
            ] as const,
        )
    : [undefined];
  if (sizeMm[2] > printer.heightMm)
    throw new Error(`The assembled model exceeds ${printer.name}'s print height.`);
  for (const size of towerSizes) {
    const towerPositions = size
      ? [printer.widthMm - size[0] - 4, 4].flatMap(x =>
          [printer.depthMm - size[1] - 4, 4].map(y => [x, y] as const),
        )
      : [undefined];
    for (const position of towerPositions) {
      const towerRect: Rect | undefined = position && [
        position[0] - 4,
        position[1] - 4,
        position[0] + size![0] + 4,
        position[1] + size![1] + 4,
      ];
      if (
        towerRect &&
        (towerRect[0] < 0 ||
          towerRect[1] < 0 ||
          towerRect[2] > printer.widthMm ||
          towerRect[3] > printer.depthMm ||
          printer.keepouts.some(r => overlaps(r, towerRect)))
      )
        continue;
      const keepouts = [...printer.keepouts, ...(towerRect ? [towerRect] : [])];
      const xs = [margin, ...keepouts.map(r => r[2] + margin)].sort((a, b) => a - b);
      const ys = [margin, ...keepouts.map(r => r[3] + margin)].sort((a, b) => a - b);
      for (const y of ys)
        for (const x of xs) {
          const footprint: Rect = [
            x - margin,
            y - margin,
            x + sizeMm[0] + margin,
            y + sizeMm[1] + margin,
          ];
          if (
            footprint[2] > printer.widthMm ||
            footprint[3] > printer.depthMm ||
            keepouts.some(r => overlaps(r, footprint))
          )
            continue;
          return {
            originMm: [x, y] as const,
            tower: position && { originMm: position, sizeMm: size! },
          };
        }
    }
  }
  throw new Error(
    `The assembled model${tower ? ' and prime tower' : ''} does not fit ${printer.name} with brim and purge clearance. Reduce the model size or choose a larger printer.`,
  );
}

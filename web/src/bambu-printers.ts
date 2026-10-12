/** Packing limits from Bambu Studio 2.5 machine profiles, in millimeters.
 * These describe layout only; exports do not embed machine G-code or temperatures.
 */
export const bambuPrinters = {
  p1s: {
    name: 'Bambu Lab P1S',
    bedMm: 256,
    heightMm: 256,
    clearanceMm: 68,
    rodHeightMm: 34,
    nozzleHeightMm: 4.2,
    excludedBedMm: [18, 28],
  },
  x1c: {
    name: 'Bambu Lab X1 Carbon',
    bedMm: 256,
    heightMm: 256,
    clearanceMm: 68,
    rodHeightMm: 34,
    nozzleHeightMm: 4.2,
    excludedBedMm: [18, 28],
  },
  a1: {
    name: 'Bambu Lab A1',
    bedMm: 256,
    heightMm: 256,
    clearanceMm: 73,
    rodHeightMm: 25,
    nozzleHeightMm: 4.76,
    excludedBedMm: [0, 0],
  },
  'a1-mini': {
    name: 'Bambu Lab A1 mini',
    bedMm: 180,
    heightMm: 180,
    clearanceMm: 73,
    rodHeightMm: 25,
    nozzleHeightMm: 4.76,
    excludedBedMm: [0, 0],
  },
} as const;

/** Supported printer layouts for Bambu downloads. */
export type BambuPrinterId = keyof typeof bambuPrinters;

/** Reject stale or untrusted selections before packing. */
export function bambuPrinter(id: BambuPrinterId = 'p1s') {
  if (!Object.hasOwn(bambuPrinters, id)) throw new Error('Choose a supported Bambu printer.');
  return bambuPrinters[id];
}

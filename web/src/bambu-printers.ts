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
    purgeKeepoutMm: [17, 0, 241, 16],
  },
  x1c: {
    name: 'Bambu Lab X1 Carbon',
    bedMm: 256,
    heightMm: 256,
    clearanceMm: 68,
    rodHeightMm: 34,
    nozzleHeightMm: 4.2,
    excludedBedMm: [18, 28],
    purgeKeepoutMm: [17, 0, 241, 16],
  },
  a1: {
    name: 'Bambu Lab A1',
    bedMm: 256,
    heightMm: 256,
    clearanceMm: 73,
    rodHeightMm: 25,
    nozzleHeightMm: 4.76,
    excludedBedMm: [0, 0],
    purgeKeepoutMm: [87, -2, 169, 1],
  },
  'a1-mini': {
    name: 'Bambu Lab A1 mini',
    bedMm: 180,
    heightMm: 180,
    clearanceMm: 73,
    rodHeightMm: 25,
    nozzleHeightMm: 4.76,
    excludedBedMm: [0, 0],
    purgeKeepoutMm: [67, -5, 116, 1],
  },
} as const;

// Purge rectangles are [minX, minY, maxX, maxY], with a 1 mm bead/wipe allowance.
// P1/X1 cover the union of 0.2/0.4/0.6/0.8 mm nozzle paths and X1 calibration
// strokes. A-series include the front-edge wipe exit; other nozzle sizes inherit
// the 0.4 mm start code. The packer adds its brim allowance outside these bounds.
// Source: BambuStudio resources/profiles/BBL/machine/*machine_start_gcode.json,
// commit 79df7ae309be398ed30c9f397c13c9911c2edc57 (checked 2026-10-23).

/** Supported printer layouts for Bambu downloads. */
export type BambuPrinterId = keyof typeof bambuPrinters;

/** Reject stale or untrusted selections before packing. */
export function bambuPrinter(id: BambuPrinterId = 'p1s') {
  if (!Object.hasOwn(bambuPrinters, id)) throw new Error('Choose a supported Bambu printer.');
  return bambuPrinters[id];
}

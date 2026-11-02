/** Conservative sequential-print limits from PrusaSlicer 2.9.6 PrusaResearch.ini.
 * Source: https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.6/resources/profiles/PrusaResearch.ini
 * Native legacy 3MF bed offsets and the nine-bed limit follow MultipleBeds.cpp.
 */
import baselines from './prusa-profiles.json';

/** Supported Prusa printers and their conservative stock placement limits. */
export const prusaPrinters = {
  mk4s: {
    name: 'Original Prusa MK4S',
    model: 'MK4S',
    bedMm: [250, 210],
    heightMm: 220,
    clearanceMm: 45,
    rodHeightMm: 13,
  },
  'core-one': {
    name: 'Prusa CORE One',
    model: 'COREONE',
    bedMm: [250, 220],
    heightMm: 270,
    clearanceMm: 75,
    rodHeightMm: 33,
  },
} as const;

/** Supported Prusa printer layouts, independent of serialized geometry settings. */
export type PrusaPrinterId = keyof typeof prusaPrinters;
/** Manual swaps happen between single-filament plates; MMU3 changes tools automatically. */
export type PrusaMaterialMode = 'manual' | 'mmu3';
/** Match the physical nozzle; high-flow profiles exist only for selected diameters. */
export type PrusaNozzleType = 'standard' | 'high-flow';

/** Reject unsupported selections before generating printer-specific placements. */
export function prusaPrinter(id: PrusaPrinterId = 'mk4s') {
  if (!Object.hasOwn(prusaPrinters, id)) throw new Error('Choose a supported Prusa printer.');
  return prusaPrinters[id];
}

/** Return a pinned, fully resolved native PLA baseline, including machine start/end code. */
export function prusaProfile(
  id: PrusaPrinterId,
  nozzleMm: number,
  mode: PrusaMaterialMode = 'manual',
  nozzleType: PrusaNozzleType = 'high-flow',
): Record<string, string> {
  prusaPrinter(id);
  if (!['manual', 'mmu3'].includes(mode)) throw new Error('Choose manual changes or MMU3.');
  if (!['standard', 'high-flow'].includes(nozzleType))
    throw new Error('Choose a supported nozzle type.');
  const variant = `${nozzleType === 'high-flow' && nozzleMm >= 0.4 ? 'HF' : ''}${nozzleMm}`;
  const profile = (baselines.profiles as Record<string, Record<string, string>>)[
    `${id}/${mode}/${variant}`
  ];
  if (!profile)
    throw new Error(
      `No stock ${prusaPrinter(id).name} ${mode === 'mmu3' ? 'MMU3 ' : ''}${variant} nozzle profile is available. Choose a supported diameter and nozzle type.`,
    );
  return { ...profile };
}

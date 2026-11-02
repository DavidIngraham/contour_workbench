/** Printers with explicit native Orca profile and sequential-packing support. */
export const orcaPrinters = {
  p1s: { name: 'Bambu Lab P1S', family: 'bambu', automatic: true },
  x1c: { name: 'Bambu Lab X1 Carbon', family: 'bambu', automatic: true },
  a1: { name: 'Bambu Lab A1', family: 'bambu', automatic: true },
  'a1-mini': { name: 'Bambu Lab A1 mini', family: 'bambu', automatic: true },
  mk4s: { name: 'Original Prusa MK4S', family: 'prusa', automatic: false },
  'core-one': { name: 'Prusa CORE One', family: 'prusa', automatic: false },
} as const;

/** A stock printer selected for a native Orca project. */
export type OrcaPrinterId = keyof typeof orcaPrinters;
/** Manual swaps occur between plates; automatic changes use the printer's AMS. */
export type OrcaMaterialMode = 'manual' | 'automatic';

/** Validate printer identity before using it to select a native baseline. */
export function orcaPrinter(id: OrcaPrinterId = 'p1s') {
  if (!Object.hasOwn(orcaPrinters, id)) throw new Error('Choose a supported OrcaSlicer printer.');
  return orcaPrinters[id];
}

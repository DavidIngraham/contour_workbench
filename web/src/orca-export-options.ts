import {
  orcaPrinters,
  orcaPrinter,
  type OrcaPrinterId,
  type OrcaMaterialMode,
} from './orca-printer-catalog';
import type { PrusaNozzleType } from './prusa-printers';

/** Shared native Orca controls for model, fit-test, and painted-test downloads. */
export function orcaExportOptions(prefix: string, painted = false) {
  return `<div id="${prefix}-orca-options" class="hidden"><label class="section-label" for="${prefix}-orca-printer">Printer</label><select id="${prefix}-orca-printer">${Object.entries(
    orcaPrinters,
  )
    .map(
      ([id, printer]) =>
        `<option value="${id}"${painted && !printer.automatic ? ' disabled' : ''}>${printer.name}</option>`,
    )
    .join(
      '',
    )}</select><label class="section-label" for="${prefix}-orca-material-mode">Filament changes</label><select id="${prefix}-orca-material-mode"><option value="automatic">AMS · automatic changes</option><option value="manual"${painted ? ' disabled' : ''}>Manual · one filament per plate</option></select><div id="${prefix}-orca-nozzle-options" class="hidden"><label class="section-label" for="${prefix}-orca-nozzle-type">Nozzle type</label><select id="${prefix}-orca-nozzle-type"><option value="high-flow">High flow (0.4 mm and larger)</option><option value="standard">Standard flow</option></select></div><p class="help">OrcaSlicer 2.4.2 project with stock PLA on textured PEI. Match your nozzle, build plate, and actual filament before slicing. Separate inserts print sequentially with printer clearance. Prusa profiles support manual changes between plates; use PrusaSlicer for MMU3. For other printers, choose Any slicer (standard 3MF) and arrange parts in your slicer.</p></div>`;
}

/** Keep available material setups consistent with the selected printer and geometry mode. */
export function syncOrcaExportOptions(prefix: string, painted = false) {
  const select = document.getElementById(`${prefix}-orca-printer`) as HTMLSelectElement;
  for (const option of select.options)
    option.disabled = painted && !orcaPrinter(option.value as OrcaPrinterId).automatic;
  if (select.selectedOptions[0].disabled) select.value = 'p1s';
  const printer = orcaPrinter(select.value as OrcaPrinterId);
  const mode = document.getElementById(`${prefix}-orca-material-mode`) as HTMLSelectElement;
  mode.options[0].disabled = !printer.automatic;
  mode.options[1].disabled = painted;
  if (!printer.automatic) mode.value = 'manual';
  else if (painted) mode.value = 'automatic';
  document
    .getElementById(`${prefix}-orca-nozzle-options`)!
    .classList.toggle('hidden', printer.family !== 'prusa');
}

/** Read export-only options without changing serialized project or geometry settings. */
export function readOrcaExportOptions(prefix: string) {
  const value = (field: string) =>
    (document.getElementById(`${prefix}-orca-${field}`) as HTMLSelectElement).value;
  return {
    orcaPrinter: value('printer') as OrcaPrinterId,
    orcaMaterialMode: value('material-mode') as OrcaMaterialMode,
    orcaNozzleType: value('nozzle-type') as PrusaNozzleType,
  };
}

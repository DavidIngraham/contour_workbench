import { prusaPrinters } from './prusa-printers';
import { orcaExportOptions } from './orca-export-options';

/** Render matching printer controls for model and calibration downloads. */
export function prusaExportOptions(prefix: string, painted = false) {
  return `<div id="${prefix}-prusa-options" class="hidden"><label class="section-label" for="${prefix}-prusa-printer">Printer</label><select id="${prefix}-prusa-printer">${Object.entries(
    prusaPrinters,
  )
    .map(([id, printer]) => `<option value="${id}">${printer.name}</option>`)
    .join(
      '',
    )}</select><label class="section-label" for="${prefix}-prusa-material-mode">Filament changes</label><select id="${prefix}-prusa-material-mode"><option value="manual"${painted ? ' disabled' : ''}>Manual · one filament per plate</option><option value="mmu3"${painted ? ' selected' : ''}>MMU3 · automatic changes</option></select><label class="section-label" for="${prefix}-prusa-nozzle-type">Nozzle type</label><select id="${prefix}-prusa-nozzle-type"><option value="high-flow">High flow (0.4 mm and larger)</option><option value="standard">Standard flow</option></select><p class="help">Starts from stock Prusament PLA profiles. Match your physical nozzle and filament before slicing. Manual changes use one filament per plate; painted multicolor prints require MMU3. Separate inserts print sequentially with printer clearance. PrusaSlicer 2.9+ opens multiple plates; supported projects contain up to nine plates.</p></div>`;
}

/** Choose the slicer and printer before generating the painted calibration test. */
export function colorCalibrationDialog() {
  return `<div class="modal-backdrop hidden" id="color-download-dialog"><section class="modal download-modal" role="dialog" aria-modal="true" aria-labelledby="color-download-title"><h2 id="color-download-title">Multicolor calibration</h2><label class="section-label" for="color-download-format">Open with</label><select id="color-download-format"><option value="bambu">Bambu Studio</option><option value="orca">OrcaSlicer</option><option value="prusa">PrusaSlicer</option></select><div id="color-bambu-options"><label class="section-label" for="color-bambu-printer">Printer</label><select id="color-bambu-printer"><option value="p1s">Bambu Lab P1S</option><option value="x1c">Bambu Lab X1 Carbon</option><option value="a1">Bambu Lab A1</option><option value="a1-mini">Bambu Lab A1 mini</option></select></div>${prusaExportOptions('color', true)}${orcaExportOptions('color', true)}<p class="help">One painted test with recessed, flush, and raised regions in three colors. Review the slice before printing.</p><div class="modal-actions"><button class="btn ghost" id="color-download-cancel">Cancel</button><button class="btn primary" id="color-download-confirm">Download</button></div></section></div>`;
}

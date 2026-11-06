import { openCalibration } from '../mobile-tests/workbench-helpers';
import { mkdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { defaults, type Project } from '../src/types';

const fixture: Project = {
  schema_version: 2,
  name: 'Prusa printer verification',
  grid: {
    bounds: [0, 0, 0.001, 0.001],
    width: 3,
    height: 3,
    elevations: [100, 101, 102, 101, 102, 103, 102, 103, 104],
  },
  source: {
    product: 'fixture',
    name: 'Sloped reference',
    attribution: 'Test',
    retrieved: '2026-11-01',
  },
  settings: { ...defaults, max_print_size_mm: [120, 110] },
  features: [0.0002, 0.0006].map((x, i) => ({
    id: `lake-${i}`,
    class: 'water',
    name: `Lake ${i}`,
    enabled: true,
    treatment: 'insert',
    lines: [],
    tags: {},
    polygons: [
      {
        outer: [
          [x, 0.0003],
          [x + 0.00015, 0.0003],
          [x + 0.00015, 0.0005],
          [x, 0.0005],
          [x, 0.0003],
        ],
        holes: [],
      },
    ],
  })),
};

for (const printer of ['mk4s', 'core-one'] as const) {
  for (const mode of ['manual', 'mmu3'] as const) {
    test(`${printer} ${mode} regular export retains printer setup and sequential plates`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
      await page.locator('#file-project').setInputFiles({
        name: 'prusa.contour.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
      await page.waitForFunction(
        () =>
          (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
      );
      await page.locator('#generate').click();
      await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
      await page.locator('#download').click();
      await page.locator('input[value="3mf"]').check();
      await page.locator('#export-slicer').selectOption('prusa');
      await expect(page.locator('#export-prusa-options')).toBeVisible();
      await expect(page.locator('#export-bambu-options')).toBeHidden();
      await page.locator('#export-prusa-printer').selectOption(printer);
      await page.locator('#export-prusa-material-mode').selectOption(mode);
      await mkdir('../temp/prusa-verification', { recursive: true });
      if (printer === 'core-one' && mode === 'manual') {
        await page.screenshot({ path: '../temp/prusa-verification/export-dialog.png' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: '../temp/prusa-verification/export-dialog-mobile.png' });
        const dialog = await page.locator('#download-dialog .modal').boundingBox();
        expect(dialog!.width).toBeLessThanOrEqual(390);
        expect(dialog!.height).toBeLessThanOrEqual(844);
      }
      const pending = page.waitForEvent('download');
      await page.locator('#download-confirm').click();
      const file = await pending;
      const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
      const config = strFromU8(files['Metadata/Slic3r_PE.config']);
      expect(config).toContain('; complete_objects = 1');
      expect(config).toContain(
        `; printer_settings_id = ${printer === 'mk4s' ? 'Original Prusa MK4S' : 'Prusa CORE One'}${mode === 'mmu3' ? ' MMU3' : ''} HF0.4 nozzle`,
      );
      const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
      expect(manifest.printer).toBe(printer);
      expect(manifest.material_mode).toBe(mode);
      expect(manifest.print_sequence).toBe('by object');
      expect(manifest.plates.flatMap((p: any) => p.objects)).toHaveLength(3);
      for (const plate of manifest.plates) expect(plate.print_sequence).toBe('by object');
      if (mode === 'manual') {
        expect(manifest.plates).toHaveLength(2);
        expect(manifest.plates.map((p: any) => p.filament.id)).toEqual(['terrain', 'water']);
        expect(strFromU8(files['Metadata/Slic3r_PE_model.config'])).not.toMatch(
          /key="extruder" value="[2-9]"/,
        );
        expect(strFromU8(files['Metadata/Slic3r_PE_model.config'])).toContain('(slot 2)');
      }
      await file.saveAs(`../temp/prusa-verification/browser-${printer}-${mode}.3mf`);
    });
  }

  test(`${printer} manual fit calibration uses its selected printer through the geometry worker`, async ({
    page,
  }) => {
    await page.goto('/');
    await openCalibration(page);
    await page.locator('#fit-download-format').selectOption('prusa');
    await expect(page.locator('#fit-prusa-options')).toBeVisible();
    await page.locator('#fit-prusa-printer').selectOption(printer);
    const pending = page.waitForEvent('download');
    await page.locator('#fit-download-confirm').click();
    const file = await pending;
    const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.printer).toBe(printer);
    expect(manifest.material_mode).toBe('manual');
    expect(manifest.plates.flatMap((p: any) => p.objects)).toHaveLength(5);
    expect(files['Metadata/calibration_manifest.json']).toBeDefined();
    await mkdir('../temp/prusa-verification', { recursive: true });
    await file.saveAs(`../temp/prusa-verification/coupon-${printer}-manual.3mf`);
  });

  test(`${printer} painted calibration exports native MMU3 painting`, async ({ page }) => {
    await page.goto('/?preset=post-canyon', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
    );
    await page.getByRole('button', { name: 'Print setup', exact: true }).click();
    await page.locator('#manufacturing-mode').selectOption('multicolor');
    await page
      .locator('.command-menu > summary')
      .filter({ hasText: /^Tools$/ })
      .click();
    await expect(page.locator('#download-color-calibration')).toBeVisible();
    await page.locator('#download-color-calibration').click();
    await page.locator('#color-download-format').selectOption('prusa');
    await page.locator('#color-prusa-printer').selectOption(printer);
    await expect(page.locator('#color-prusa-material-mode')).toHaveValue('mmu3');
    const pending = page.waitForEvent('download');
    await page.locator('#color-download-confirm').click();
    const file = await pending;
    const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
    expect(strFromU8(files['3D/3dmodel.model'])).toContain('mmu_segmentation=');
    expect(strFromU8(files['Metadata/Slic3r_PE.config'])).toContain('; wipe_tower = 1');
    expect(strFromU8(files['Metadata/coupon-instructions.txt'])).toContain('PrusaSlicer');
    expect(
      JSON.parse(strFromU8(files['Metadata/multicolor_coupon.json'])).rows_front_to_back_offset_mm,
    ).toEqual([-0.3, 0, 0.35]);
    await mkdir('../temp/prusa-verification', { recursive: true });
    await file.saveAs(`../temp/prusa-verification/painted-coupon-${printer}.3mf`);
  });
}

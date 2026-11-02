import { mkdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { defaults, type Project } from '../src/types';
import { orcaPrinters } from '../src/orca-printer-catalog';

const fixture: Project = {
  schema_version: 2,
  name: 'Orca printer verification',
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

async function loadFixture(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'orca.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
}

for (const printer of Object.keys(orcaPrinters) as Array<keyof typeof orcaPrinters>) {
  test(`${printer} Orca project preserves native settings and all sequential parts`, async ({
    page,
  }) => {
    await loadFixture(page);
    await page.locator('#generate').click();
    await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
    await page.locator('#download').click();
    await page.locator('input[value="3mf"]').check();
    await page.locator('#export-slicer').selectOption('orca');
    await expect(page.locator('#export-orca-options')).toBeVisible();
    await expect(page.locator('#export-bambu-options')).toBeHidden();
    await expect(page.locator('#export-prusa-options')).toBeHidden();
    await page.locator('#export-orca-printer').selectOption(printer);
    const mode = orcaPrinters[printer].automatic ? 'automatic' : 'manual';
    await expect(page.locator('#export-orca-material-mode')).toHaveValue(mode);
    await mkdir('../temp/orca-verification', { recursive: true });
    if (printer === 'core-one') {
      await page.screenshot({ path: '../temp/orca-verification/export-dialog.png' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '../temp/orca-verification/export-dialog-mobile.png' });
      const dialog = await page.locator('#download-dialog .modal').boundingBox();
      expect(dialog!.width).toBeLessThanOrEqual(390);
      expect(dialog!.height).toBeLessThanOrEqual(844);
    }
    const pending = page.waitForEvent('download');
    await page.locator('#download-confirm').click();
    const file = await pending;
    const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
    const config = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(config.printer_settings_id).toBe(
      printer === 'mk4s'
        ? 'Prusa MK4S HF0.4 nozzle'
        : printer === 'core-one'
          ? 'Prusa CORE One HF 0.4 nozzle'
          : `${orcaPrinters[printer].name} 0.4 nozzle`,
    );
    expect(config.print_sequence).toBe('by object');
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest).toMatchObject({ format: 'orca', printer, material_mode: mode });
    expect(manifest.plates.flatMap((p: any) => p.objects)).toHaveLength(3);
    expect(strFromU8(files['3D/3dmodel.model'])).toContain(
      '<metadata name="OrcaSlicer">2.4.2</metadata>',
    );
    if (mode === 'manual') {
      expect(manifest.plates).toHaveLength(2);
      expect(config.filament_colour).toHaveLength(1);
      expect(strFromU8(files['Metadata/model_settings.config'])).not.toMatch(
        /key="extruder" value="[2-9]"/,
      );
    }
    await file.saveAs(`../temp/orca-verification/browser-${printer}-${mode}.3mf`);
  });
}

for (const printer of ['a1-mini', 'core-one'] as const) {
  test(`${printer} Orca fit coupon passes selected settings through the geometry worker`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#landing-calibration').click();
    await page.locator('#fit-download-format').selectOption('orca');
    await page.locator('#fit-orca-printer').selectOption(printer);
    const pending = page.waitForEvent('download');
    await page.locator('#fit-download-confirm').click();
    const file = await pending;
    const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
    const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
    expect(manifest.printer).toBe(printer);
    expect(manifest.plates.flatMap((p: any) => p.objects)).toHaveLength(5);
    expect(files['Metadata/calibration_manifest.json']).toBeDefined();
    await mkdir('../temp/orca-verification', { recursive: true });
    await file.saveAs(`../temp/orca-verification/coupon-${printer}.3mf`);
  });
}

for (const printer of ['p1s', 'x1c', 'a1', 'a1-mini'] as const) {
  test(`${printer} Orca painted calibration retains colors and automatic-change setup`, async ({
    page,
  }) => {
    await loadFixture(page);
    await page.getByRole('button', { name: 'Print setup', exact: true }).click();
    await page.locator('#manufacturing-mode').selectOption('multicolor');
    await page
      .locator('.command-menu > summary')
      .filter({ hasText: /^Tools$/ })
      .click();
    await page.locator('#download-color-calibration').click();
    await page.locator('#color-download-format').selectOption('orca');
    await page.locator('#color-orca-printer').selectOption(printer);
    await expect(page.locator('#color-orca-printer option[value="mk4s"]')).toBeDisabled();
    const pending = page.waitForEvent('download');
    await page.locator('#color-download-confirm').click();
    const file = await pending;
    const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
    const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(settings).toMatchObject({ print_sequence: 'by layer', enable_prime_tower: '1' });
    expect(settings.filament_colour).toHaveLength(3);
    expect(strFromU8(files['3D/Objects/object_1.model'])).toContain('paint_color=');
    expect(strFromU8(files['Metadata/coupon-instructions.txt'])).toContain('OrcaSlicer');
    await mkdir('../temp/orca-verification', { recursive: true });
    await file.saveAs(`../temp/orca-verification/painted-coupon-${printer}.3mf`);
  });
}

test('Post Canyon Orca export retains every printable insert across sequential plates', async ({
  page,
}) => {
  await page.goto('/?preset=post-canyon', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.locator('#generate').click();
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics.busy &&
      (window as any).contourDiagnostics.asset?.watertight,
    undefined,
    {
      timeout: 180_000,
    },
  );
  await page.locator('#download').click();
  await page.locator('input[value="3mf"]').check();
  await page.locator('#export-slicer').selectOption('orca');
  const pending = page.waitForEvent('download');
  await page.locator('#download-confirm').click();
  const file = await pending;
  const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
  const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
  expect(manifest.plates.length).toBeGreaterThan(1);
  expect(manifest.plates.flatMap((p: any) => p.objects)).toHaveLength(46);
  expect(manifest.plates.every((p: any) => p.print_sequence === 'by object')).toBe(true);
  await mkdir('../temp/orca-verification', { recursive: true });
  await file.saveAs('../temp/orca-verification/post-canyon-large.3mf');
});

test('Post Canyon painted Orca project fits its assembly and prime tower on the native bed', async ({
  page,
}) => {
  await page.goto('/?preset=post-canyon', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  await page.locator('#manufacturing-mode').selectOption('multicolor');
  await page.locator('#generate').click();
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics.busy &&
      (window as any).contourDiagnostics.asset?.watertight,
    undefined,
    { timeout: 180_000 },
  );
  await page.locator('#download').click();
  await page.locator('input[value="3mf"]').check();
  await page.locator('#export-slicer').selectOption('orca');
  const pending = page.waitForEvent('download');
  await page.locator('#download-confirm').click();
  const file = await pending;
  const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
  const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
  expect(settings.prime_tower_width).not.toBe('35');
  expect(settings.filament_colour).toEqual(['#8BAA73', '#E78A43']);
  expect(strFromU8(files['3D/Objects/object_1.model'])).toContain('paint_color=');
  await mkdir('../temp/orca-verification', { recursive: true });
  await file.saveAs('../temp/orca-verification/post-canyon-painted.3mf');
});

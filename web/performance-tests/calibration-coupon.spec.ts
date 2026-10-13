import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test('fit coupon contains detailed switchback trail inserts', async ({ page }) => {
  await page.goto('/?preset=post-canyon', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      Boolean((window as any).contourDiagnostics?.triangles) &&
      !(window as any).contourDiagnostics.busy,
    null,
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.locator('#download-calibration').click();
  await page.locator('#fit-download-format').selectOption('stl');
  await page.locator('#fit-download-confirm').click();
  const download = await pending,
    path = await download.path();
  expect(path).toBeTruthy();
  const files = unzipSync(new Uint8Array(await readFile(path!))),
    manifest = JSON.parse(strFromU8(files['calibration_manifest.json']));
  expect(manifest).toMatchObject({
    geometry: 'trail_switchback',
    path_width_mm: 0.9,
    nozzle_diameter_mm: 0.4,
    terrain: { name: 'Mt. Hood Meadows', relief_mm: 1.2 },
  });
  expect(manifest.pieces.map((piece: any) => piece.clearance_per_side_mm)).toEqual([
    0.1, 0.15, 0.2, 0.25,
  ]);
  for (const name of ['coupon-base.stl', ...manifest.pieces.map((piece: any) => piece.file)]) {
    const facets = (strFromU8(files[name]).match(/facet normal/g) || []).length;
    expect(facets, `${name} should retain detailed switchback geometry`).toBeGreaterThan(500);
  }
  const vertices = [
    ...strFromU8(files['coupon-base.stl']).matchAll(/vertex ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g),
  ].map(match => match.slice(1).map(Number));
  for (const [axis, size] of [
    [0, 100],
    [1, 38],
  ]) {
    expect(Math.min(...vertices.map(v => v[axis]))).toBeCloseTo(0, 3);
    expect(Math.max(...vertices.map(v => v[axis]))).toBeCloseTo(size, 3);
  }
  const terrainVertices = vertices.filter(([, y, z]) => y < 28 && z > 2);
  expect(terrainVertices.length).toBeGreaterThan(1000);
  expect(new Set(terrainVertices.map(([, , z]) => z.toFixed(3))).size).toBeGreaterThan(100);
  expect(Math.max(...vertices.map(([, , z]) => z))).toBeLessThanOrEqual(3.201);
  expect(Math.max(...vertices.filter(([, y]) => y > 28).map(([, , z]) => z))).toBeCloseTo(3, 3);
  // Relief must span every insert region, rather than occupy a separate patch.
  for (const center of [14, 38, 62, 86]) {
    const region = terrainVertices.filter(([x, y]) => Math.abs(x - center) < 8 && y > 5 && y < 23);
    expect(new Set(region.map(([, , z]) => z.toFixed(3))).size).toBeGreaterThan(10);
    expect(
      vertices.some(([x, y, z]) => Math.abs(x - center) < 8 && y < 23 && Math.abs(z - 1) < 1e-5),
    ).toBe(true);
  }
});

for (const variant of ['portable', 'bambu', 'prusa', 'bambu-mini']) {
  const format = variant === 'bambu-mini' ? 'bambu' : variant;
  test(`landing fit test downloads a single ${variant} 3MF without a project`, async ({ page }) => {
    await page.goto('/');
    await page.locator('#landing-calibration').click();
    await expect(page.locator('#fit-download-format')).toHaveValue('portable');
    await page.locator('#fit-download-cancel').click();
    await expect(page.locator('#landing-calibration')).toBeFocused();
    await page.locator('#landing-calibration').click();
    await page.locator('#fit-download-format').selectOption(format);
    if (variant === 'bambu-mini') await page.locator('#fit-bambu-printer').selectOption('a1-mini');
    const pending = page.waitForEvent('download');
    await page.locator('#fit-download-confirm').click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('Contour Workbench fit test.3mf');
    const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    expect(files['3D/3dmodel.model']).toBeTruthy();
    const manifest = JSON.parse(strFromU8(files['Metadata/calibration_manifest.json']));
    expect(manifest.pieces).toHaveLength(4);
    expect(files['Metadata/fit-test-instructions.txt']).toBeTruthy();
    if (format === 'bambu') {
      expect(strFromU8(files['3D/3dmodel.model'])).toContain('BambuStudio-2.0.0');
      expect(JSON.parse(strFromU8(files['Metadata/project_settings.config']))).toMatchObject({
        print_sequence: 'by object',
        printer_settings_id:
          variant === 'bambu-mini' ? 'Bambu Lab A1 mini 0.4 nozzle' : 'Bambu Lab P1S 0.4 nozzle',
        filament_colour: ['#8BAA73', '#E78A43'],
      });
      expect(strFromU8(files['Metadata/model_settings.config']).match(/<plate>/g)).toHaveLength(1);
      expect(strFromU8(files['Metadata/model_settings.config'])).toContain(
        'key="print_sequence" value="by object"',
      );
      expect(
        strFromU8(files['Metadata/layer_heights_profile.txt']).trim().split('\n'),
      ).toHaveLength(5);
      await mkdir('../temp', { recursive: true });
      await download.saveAs(`../temp/fit-test-${variant}.3mf`);
    }
    expect(Object.keys(files).some(name => name.endsWith('.stl'))).toBe(false);
    const models = Object.entries(files).filter(([name]) => name.endsWith('.model'));
    expect(
      models.reduce(
        (count, [, bytes]) => count + (strFromU8(bytes).match(/<mesh>/g) || []).length,
        0,
      ),
    ).toBe(5);
    await expect(page.locator('#landing-dialog')).toBeVisible();
    if (format === 'portable') {
      await mkdir('../temp', { recursive: true });
      await page.screenshot({ path: '../temp/fit-test-landing.png' });
      await page.locator('#landing-calibration').click();
      await expect(page.locator('#fit-download-dialog')).toBeVisible();
      await page.screenshot({ path: '../temp/fit-test-formats.png' });
    }
  });
}

test('multicolor coupon downloads three painted filaments and a dimensional legend', async ({
  page,
}) => {
  await page.goto('/?preset=post-canyon', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  await page.locator('#manufacturing-mode').selectOption('multicolor');
  await expect(page.locator('#fit-calibration')).toBeHidden();
  await expect(page.locator('#fit-clearance')).toBeHidden();
  await expect(page.locator('#path-width')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.locator('#download-color-calibration').click();
  const file = await pending;
  const bytes = await readFile((await file.path())!);
  const files = unzipSync(bytes);
  const legend = JSON.parse(strFromU8(files['Metadata/multicolor_coupon.json']));
  expect(legend.rows_front_to_back_offset_mm).toEqual([-0.3, 0, 0.35]);
  const model = strFromU8(files['3D/Objects/object_1.model']);
  expect(new Set([...model.matchAll(/paint_color="([^"]+)"/g)].map(m => m[1]))).toEqual(
    new Set(['4', '8', '0C']),
  );
  await mkdir('../temp/painted-validation', { recursive: true });
  await writeFile('../temp/painted-validation/multicolor-coupon.3mf', bytes);
});

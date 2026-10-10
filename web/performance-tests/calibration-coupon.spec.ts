import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test('fit coupon contains detailed switchback trail inserts', async ({ page }) => {
  await page.goto('/?preset=post-canyon');
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
  const download = await pending,
    path = await download.path();
  expect(path).toBeTruthy();
  const files = unzipSync(new Uint8Array(await readFile(path!))),
    manifest = JSON.parse(strFromU8(files['calibration_manifest.json']));
  expect(manifest).toMatchObject({
    geometry: 'trail_switchback',
    path_width_mm: 0.9,
    nozzle_diameter_mm: 0.4,
  });
  expect(manifest.pieces.map((piece: any) => piece.clearance_per_side_mm)).toEqual([
    0.1, 0.15, 0.2, 0.25,
  ]);
  for (const name of ['coupon-base.stl', ...manifest.pieces.map((piece: any) => piece.file)]) {
    const facets = (strFromU8(files[name]).match(/facet normal/g) || []).length;
    expect(facets, `${name} should retain detailed switchback geometry`).toBeGreaterThan(500);
  }
});

test('multicolor coupon downloads three painted filaments and a dimensional legend', async ({
  page,
}) => {
  await page.goto('/?preset=post-canyon');
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

import { readFile } from 'node:fs/promises';
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

for (const floorMm of [1, 5, 20])
  test(`fit coupon with a ${floorMm} mm floor preserves switchback fit`, async ({ page }) => {
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
    await page.locator('#coupon-floor-thickness').fill(String(floorMm));
    await expect(page.locator('#coupon-label-preview')).toContainText(
      `FLOOR ${floorMm.toFixed(2)} MM`,
    );
    await page.locator('#coupon-path_width_mm').fill('1.10');
    await page.locator('#coupon-insert_depth_mm').fill('2.50');
    for (const [i, value] of ['0.06', '0.14', '0.22', '0.30'].entries())
      await page.locator(`#coupon-clearance-${i + 1}`).fill(value);
    await expect(page.locator('#coupon-label-preview')).toContainText('INSERT DEPTH 2.50 MM');
    await page.locator('#fit-download-format').selectOption('stl');
    await page.locator('#fit-download-confirm').click();
    const download = await pending,
      path = await download.path();
    expect(path).toBeTruthy();
    const files = unzipSync(new Uint8Array(await readFile(path!))),
      manifest = JSON.parse(strFromU8(files['calibration_manifest.json']));
    expect(manifest).toMatchObject({
      geometry: 'trail_switchback',
      path_width_mm: 1.1,
      insert_depth_mm: 2.5,
      floor_thickness_mm: floorMm,
      total_height_mm: floorMm + 2.7,
      nozzle_diameter_mm: 0.4,
      label_surface: 'bottom',
      label_depth_mm: 0.4,
      minimum_floor_after_engraving_mm: floorMm - 0.4,
      terrain: { name: 'Mt. Hood Meadows', relief_mm: 1.2 },
    });
    expect(manifest.pieces.map((piece: any) => piece.clearance_per_side_mm)).toEqual([
      0.06, 0.14, 0.22, 0.3,
    ]);
    for (const name of ['coupon-base.stl', ...manifest.pieces.map((piece: any) => piece.file)]) {
      const facets = (strFromU8(files[name]).match(/facet normal/g) || []).length;
      expect(facets, `${name} should retain detailed switchback geometry`).toBeGreaterThan(500);
    }
    const insertVertices = [
      ...strFromU8(files[manifest.pieces[0].file]).matchAll(
        /vertex ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g,
      ),
    ].map(match => match.slice(1).map(Number));
    expect(Math.min(...insertVertices.map(v => v[2]))).toBeCloseTo(0, 3);
    expect(Math.max(...insertVertices.map(v => v[2]))).toBeCloseTo(2.5, 3);
    const vertices = [
      ...strFromU8(files['coupon-base.stl']).matchAll(
        /vertex ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g,
      ),
    ].map(match => match.slice(1).map(Number));
    for (const [axis, size] of [
      [0, 100],
      [1, 28],
    ]) {
      expect(Math.min(...vertices.map(v => v[axis]))).toBeCloseTo(0, 3);
      expect(Math.max(...vertices.map(v => v[axis]))).toBeCloseTo(size, 3);
    }
    const terrainVertices = vertices.filter(([, y, z]) => y < 28 && z > floorMm + 1.5);
    expect(terrainVertices.length).toBeGreaterThan(1000);
    expect(new Set(terrainVertices.map(([, , z]) => z.toFixed(3))).size).toBeGreaterThan(100);
    expect(Math.max(...vertices.map(([, , z]) => z))).toBeCloseTo(floorMm + 2.7, 3);
    // Every lettering row opens from the bottom, mirrored in Y for a long-edge flip.
    for (let row = 0; row < 7; row++) {
      const y0 = 28 - (1 + row * 3.8) - 3.15;
      expect(
        vertices.filter(([, y, z]) => y >= y0 - 0.01 && y <= y0 + 3.2 && Math.abs(z - 0.4) < 1e-4)
          .length,
      ).toBeGreaterThan(30);
    }
    await mkdir('../temp', { recursive: true });
    await writeFile('../temp/custom-fit-coupon.stl', files['coupon-base.stl']);
    expect(
      vertices
        .filter(([, , z]) => z > 1e-5 && z < floorMm - 1e-5)
        // Boolean triangulation can add vertices along the recessed letter walls.
        .every(([, , z]) => z <= 0.4 + 1e-4),
    ).toBe(true);
    await expect(page.locator('#path-width')).toHaveValue('0.9');
    await expect(page.locator('#insert-depth')).toHaveValue('2');
    // Relief must span every insert region, rather than occupy a separate patch.
    for (const center of [14, 38, 62, 86]) {
      const region = terrainVertices.filter(
        ([x, y]) => Math.abs(x - center) < 8 && y > 5 && y < 23,
      );
      expect(new Set(region.map(([, , z]) => z.toFixed(3))).size).toBeGreaterThan(10);
      expect(
        vertices.some(
          ([x, y, z]) => Math.abs(x - center) < 8 && y < 23 && Math.abs(z - floorMm) < 1e-5,
        ),
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
        print_sequence: 'by layer',
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
    if (format === 'prusa') {
      expect(strFromU8(files['Metadata/Slic3r_PE.config'])).toContain(
        '; filament_colour = #8BAA73;#E78A43',
      );
      const assignments = strFromU8(files['Metadata/Slic3r_PE_model.config']);
      expect(assignments.match(/<object /g)).toHaveLength(5);
      expect(assignments.match(/key="extruder" value="2"/g)).toHaveLength(4);
      await mkdir('../temp', { recursive: true });
      await download.saveAs('../temp/fit-test-prusa.3mf');
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

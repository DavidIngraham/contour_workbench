import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test('one thickness control grows the coupon and inserts without changing the lower taper', async ({
  page,
}) => {
  await page.goto('/');
  const results: { insert: number[][]; baseHeight: number }[] = [];
  for (const depth of [2, 5]) {
    await page.locator('#landing-calibration').click();
    await page.locator('#coupon-insert_depth_mm').fill(String(depth));
    await expect(page.locator('#fit-download-confirm')).toBeEnabled();
    await page.locator('#fit-download-format').selectOption('stl');
    const pending = page.waitForEvent('download');
    await page.locator('#fit-download-confirm').click();
    const download = await pending;
    const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
    const manifest = JSON.parse(strFromU8(files['calibration_manifest.json']));
    expect(manifest).toMatchObject({
      insert_depth_mm: depth,
      floor_thickness_mm: 1,
      total_height_mm: depth + 1.2,
      draft_angle_deg: 1.5,
      draft_height_mm: 1.7,
      draft_height_limit_mm: 1.7,
      elephant_foot_height_mm: 0.4,
    });
    const vertices = (name: string) =>
      [...strFromU8(files[name]).matchAll(/vertex ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g)].map(
        match => match.slice(1).map(Number),
      );
    const insert = vertices(manifest.pieces[0].file);
    expect(Math.min(...insert.map(v => v[2]))).toBeCloseTo(0, 4);
    expect(Math.max(...insert.map(v => v[2]))).toBeCloseTo(depth, 4);
    const baseHeight = Math.max(...vertices('coupon-base.stl').map(v => v[2]));
    expect(baseHeight).toBeCloseTo(depth + 1.2, 3);
    results.push({ insert, baseHeight });
  }
  expect(results[1].baseHeight - results[0].baseHeight).toBeCloseTo(3, 3);
  // Boolean triangulation can change vertices. Compare physical contours at
  // several heights instead, within 0.002 mm of native meshing tolerance.
  const slice = (mesh: number[][], z: number) => {
    const segments: number[][][] = [];
    for (let i = 0; i < mesh.length; i += 3) {
      const points: number[][] = [];
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const from = mesh[i + a],
          to = mesh[i + b];
        if ((from[2] - z) * (to[2] - z) >= 0) continue;
        const t = (z - from[2]) / (to[2] - from[2]);
        points.push([from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]);
      }
      if (points.length === 2) segments.push(points);
    }
    return segments;
  };
  const distance = (point: number[], segment: number[][]) => {
    const [a, b] = segment,
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
  };
  for (const height of [0.05, 0.3, 0.7, 1.1, 1.6, 1.9]) {
    const a = slice(results[0].insert, height),
      b = slice(results[1].insert, height);
    expect(a.length).toBeGreaterThan(20);
    expect(b.length).toBeGreaterThan(20);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ])
      for (const point of from.flat())
        expect(Math.min(...to.map(segment => distance(point, segment)))).toBeLessThan(0.002);
  }
});

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
    await page.getByText('Solid floor beneath pockets · advanced', { exact: true }).click();
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

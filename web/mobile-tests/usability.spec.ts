import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  const project = {
    schema_version: 2,
    name: 'Mobile landscape',
    grid: {
      bounds: [-0.001, -0.001, 0.011, 0.011],
      width: 5,
      height: 5,
      elevations: Array(25).fill(100),
    },
    source: {
      product: 'test',
      name: 'Test elevation',
      retrieved: '2026-09-30T00:00:00Z',
      attribution: 'Test',
    },
    features: [
      {
        id: 'trail:1',
        name: 'Test trail',
        class: 'trail',
        lines: [
          [
            [0.003, 0.005],
            [0.007, 0.005],
          ],
        ],
        polygons: [],
        enabled: true,
        treatment: 'insert',
        surface: 'terrain',
        tags: {},
      },
      {
        id: 'water:1',
        name: 'Test lake',
        class: 'water',
        lines: [],
        polygons: [
          {
            outer: [
              [0.002, 0.002],
              [0.008, 0.002],
              [0.008, 0.004],
              [0.002, 0.004],
              [0.002, 0.002],
            ],
            holes: [],
          },
        ],
        enabled: true,
        treatment: 'insert',
        surface: 'terrain',
        tags: {},
      },
    ],
    settings: {
      max_print_size_mm: [150, 150],
      height_factor: 1,
      base_height_mm: 1,
      path_width_mm: 0.9,
      path_clearance_mm: 0.1,
      insert_depth_mm: 2,
      zone_insert_depth_mm: 0.8,
      zone_floor_mm: 0.8,
      ski_run_width_m: 30,
      carve_depth_mm: 0.4,
      insert_gap_mm: 0.5,
      insert_segment_size_mm: null,
      terrain_max_error_mm: 0,
      boundary: [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0.01],
      ],
    },
  };
  await page.goto('/');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'mobile.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      !!(window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  expect(await page.evaluate(() => (window as any).contourDiagnostics.previewStageHistory)).toEqual(
    ['topo', 'terrain', 'features'],
  );
});
test('full-width model, touch controls, settings and feature editing', async ({
  page,
}, testInfo) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const viewport = await page.locator('#viewport').boundingBox();
  expect(viewport!.width).toBe(page.viewportSize()!.width);
  for (const id of [
    'mobile-settings',
    'fit-view',
    'wireframe',
    'generate',
    'open-project',
    'save-project',
  ]) {
    const b = await page.locator('#' + id).boundingBox();
    expect(b!.width).toBeGreaterThanOrEqual(44);
    expect(b!.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('#wireframe').tap();
  await expect(page.locator('#wireframe')).toHaveClass(/active/);
  await page.locator('#mobile-settings').tap();
  await expect(page.locator('#mobile-settings')).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: /^Features/, exact: false }).tap();
  await page.locator('[data-class-treatment="trail"]').selectOption('v_carve');
  await page.waitForFunction(() => !(window as any).contourDiagnostics.overlayBusy);
  await page.locator('[data-toggle]').first().uncheck();
  await page.locator('[data-toggle]').first().check();
  await expect(page.locator('[data-treatment]').first()).toHaveValue('v_carve');
  const lake = page.locator('[data-feature]').filter({ hasText: 'Test lake' });
  await lake.tap();
  await expect(lake.locator('[data-surface]')).toBeVisible();
  await lake.locator('[data-surface]').selectOption('level');
  await expect(lake.locator('[data-zone-depth]')).toBeVisible();
  await page.getByRole('button', { name: 'Print setup', exact: true }).tap();
  await expect(page.locator('#nozzle-diameter')).toHaveValue('0.4');
  await expect(page.locator('#edge-clearance')).toHaveValue('1');
  await expect(page.locator('#terrain-island-width')).toHaveValue('');
  await expect(page.locator('#terrain-island-guidance')).toContainText('Auto: 1.35 mm');
  await expect(page.locator('#download-calibration')).toBeVisible();
  await expect(page.locator('#insert-surface-mode')).toHaveValue('proud');
  await expect(page.locator('#proud-height-control')).toBeVisible();
  const terrainBuildsBeforePlacement = await page.evaluate(
    () => (window as any).contourDiagnostics.terrainBuilds,
  );
  await page.locator('#insert-surface-mode').selectOption('inset');
  await expect(page.locator('#inset-depth-control')).toBeVisible();
  await page.locator('#insert-inset-depth').fill('0.4');
  await page.locator('#insert-inset-depth').blur();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.overlayBusy);
  await expect(page.locator('#insert-surface-guidance')).toContainText('0.40 mm below');
  expect(await page.evaluate(() => (window as any).contourDiagnostics.terrainBuilds)).toBe(
    terrainBuildsBeforePlacement,
  );
  await page.locator('#manufacturing-mode').selectOption('multicolor');
  await expect(page.locator('#fit-clearance')).toBeDisabled();
  await page.locator('#feature-extruder').fill('3');
  await page.locator('#mobile-close').tap();
  await expect(page.locator('#mobile-settings')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#generate').tap();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight)).toBe(
    true,
  );
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#asset-summary')).toContainText('Inset · 0.40 mm below');
  await page.locator('#generate').tap();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight)).toBe(
    true,
  );
  if (testInfo.project.name === 'phone') {
    await page.locator('#download').tap();
    await expect(page.locator('.format-option')).toHaveCount(7);
    await expect(page.locator('#bambu-export-note')).toContainText('0.20 mm layers');
    await page.locator('input[value=portable]').check();
    let pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape.3mf');
    await page.locator('#download').tap();
    await page.locator('input[value=bambu]').check();
    pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape-bambu.3mf');
    await page.locator('#download').tap();
    await page.locator('input[value=prusa]').check();
    pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape-prusa.3mf');
    await page.locator('#download').tap();
    await page.locator('input[value=shapeways-color]').check();
    pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe(
      'Mobile landscape-shapeways-color.zip',
    );
  }
});
test('polygon picker and annotation controls stay reachable', async ({ page }) => {
  await page.locator('#mobile-settings').tap();
  await page.locator('#change-area').tap();
  await expect(page.locator('#area-dialog')).toBeVisible();
  await expect(page.locator('#area-dialog')).toHaveAttribute('data-ready', 'true');
  await page.locator('#extent-shape').selectOption('rectangle');
  await page.locator('#extent-width').fill('600');
  await page.locator('#extent-height').fill('400');
  await page.locator('#extent-angle').fill('35');
  await page.locator('#extent-radius').fill('50');
  await expect(page.locator('#area-reuse')).toBeEnabled();
  await page.locator('#area-reuse').tap();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await page.locator('#mobile-settings').tap();
  await page.locator('#change-area').tap();
  await expect(page.locator('#area-dialog')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#extent-shape')).toHaveValue('rectangle');
  await expect(page.locator('#extent-angle')).toHaveValue('35');
  await expect(page.locator('#extent-radius')).toHaveValue('50');
  await page.locator('#extent-shape').selectOption('spline');
  await expect(page.locator('#extent-radius')).toBeDisabled();
  await page.locator('#extent-angle').fill('15');
  await page.locator('#extent-shape').selectOption('circle');
  await page.locator('#extent-width').fill('600');
  await expect(page.locator('#extent-angle')).toBeDisabled();
  await expect(page.locator('#area-reuse')).toBeEnabled();
  await page.locator('#area-reuse').tap();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await expect(page.locator('#area-dialog')).toBeHidden();
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: 'Annotations', exact: true }).tap();
  await page.locator('#add-text').tap();
  await page.locator('#ann-text').fill('Mobile');
  await page.locator('[data-ann-number="width_mm"]').fill('20');
  await expect(page.locator('#annotation-warning')).toHaveText('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#mobile-close').tap();
  await expect(page.locator('#generate')).toBeVisible();
});

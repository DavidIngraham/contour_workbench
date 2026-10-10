import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Project } from '../src/types';
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
test('GPX uploads append named features and survive project export and reopening', async ({
  page,
}, testInfo) => {
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: /^Features/ }).tap();
  const track = {
    name: 'ridge.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx><trk><name>Ridge &amp; River</name><trkseg><trkpt lat="0.007" lon="0.002"/><trkpt lat="0.007" lon="0.008"/></trkseg></trk></gpx>',
    ),
  };
  const route = {
    name: 'return.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(
      '<gpx><rte><name>Return route</name><rtept lat="0.009" lon="0.002"/><rtept lat="0.009" lon="0.008"/></rte></gpx>',
    ),
  };
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload GPX', exact: true }).tap();
  await (await chooser).setFiles([track, route]);
  await expect(page.locator('[data-feature]')).toHaveCount(4);
  await expect(page.locator('#upload-gpx')).toBeEnabled();
  const ridge = page.locator('[data-feature]').filter({ hasText: 'Ridge & River' });
  await expect(ridge).toHaveCount(1);
  await expect(ridge.locator('[data-toggle]')).toBeChecked();
  await ridge.locator('[data-treatment]').selectOption('v_carve');
  await ridge.locator('[data-toggle]').uncheck();
  await expect(ridge.locator('[data-toggle]')).not.toBeChecked();
  await ridge.locator('[data-toggle]').check();

  // The same file can be selected again and must produce an independent feature.
  await page.locator('#file-gpx').setInputFiles(track);
  await expect(ridge).toHaveCount(2);
  await expect(page.locator('#upload-gpx')).toBeEnabled();
  await page.locator('#file-gpx').setInputFiles([
    route,
    {
      name: 'invalid.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from('<gpx><wpt lat="0" lon="0"/></gpx>'),
    },
  ]);
  await expect(page.locator('#status')).toContainText('No usable tracks or routes');
  await expect(page.locator('[data-feature]')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('gpx-features.png') });
  await page.locator('#mobile-close').tap();
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#save-project').tap();
  const downloaded = await pendingDownload;
  const contents = await readFile((await downloaded.path())!, 'utf8');
  const saved = JSON.parse(contents) as Project;
  const imported = saved.features.filter(feature => feature.tags.source === 'gpx');
  expect(imported).toHaveLength(3);
  expect(new Set(imported.map(feature => feature.id)).size).toBe(3);
  expect(imported[0].treatment).toBe('v_carve');
  await page.locator('#file-project').setInputFiles({
    name: 'gpx.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contents),
  });
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: /^Features/ }).tap();
  await expect(page.locator('[data-feature]')).toHaveCount(5);
  await expect(ridge).toHaveCount(2);
  await page.locator('#mobile-close').tap();
  await page.locator('#generate').tap();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight)).toBe(
    true,
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
  await expect(page.locator('#insert-relative-height')).toHaveValue('0.35');
  await expect(page.locator('#insert-surface-mode')).toHaveCount(0);
  await expect(
    page.getByText('Positive stands proud, zero is flush, and negative is inset.'),
  ).toBeVisible();
  const terrainBuildsBeforePlacement = await page.evaluate(
    () => (window as any).contourDiagnostics.terrainBuilds,
  );
  await page.locator('#insert-relative-height').fill('-0.4');
  await page.locator('#insert-relative-height').blur();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.overlayBusy);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.terrainBuilds)).toBe(
    terrainBuildsBeforePlacement,
  );
  await page.locator('#manufacturing-mode').selectOption('multicolor');
  await expect(page.locator('#fit-clearance')).toBeDisabled();
  await expect(page.locator('#segment')).toBeDisabled();
  await expect(page.locator('#insert-gap')).toBeDisabled();
  await expect(page.locator('#terrain-island-width')).toBeDisabled();
  await expect(page.locator('#fit-calibration')).toBeHidden();
  await page.locator('#material-trail-extruder').fill('3');
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
    await expect(page.locator('.format-option')).toHaveCount(2);
    await expect(page.locator('#export-mode-note')).toContainText('Print together');
    await page.locator('input[value="3mf"]').check();
    await page.locator('#export-slicer').selectOption('portable');
    await page.screenshot({ path: testInfo.outputPath('export-options.png') });
    let pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape.3mf');
    await page.locator('#download').tap();
    await page.locator('#export-slicer').selectOption('bambu');
    pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape-bambu.3mf');
    await page.locator('#download').tap();
    await page.locator('#export-slicer').selectOption('prusa');
    pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape-prusa.3mf');
    await page.locator('#download').tap();
    await page.locator('input[value=stl]').check();
    await expect(page.locator('#three-mf-options')).toBeHidden();
    await expect(page.locator('#export-format-note')).toContainText('loses painted colors');
    pendingDownload = page.waitForEvent('download');
    await page.locator('#download-confirm').tap();
    expect((await pendingDownload).suggestedFilename()).toBe('Mobile landscape.zip');
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

test('Overpass failure keeps terrain usable and offers a successful retry', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  let recover = false;
  let attempts = 0;
  await page.route('**/api/interpreter', async route => {
    attempts++;
    if (!recover) {
      // Keep the request in flight long enough to verify that retry progress is visible.
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({ status: 504, body: 'Gateway Timeout' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        elements: [
          {
            type: 'way',
            id: 9001,
            tags: { highway: 'path', name: 'Recovered trail' },
            geometry: [
              { lon: 0.003, lat: 0.006 },
              { lon: 0.007, lat: 0.006 },
            ],
          },
        ],
      }),
    });
  });
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: /^Features/, exact: false }).tap();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#status')).toContainText('Loading trails and water… Attempt 1 of 4');
  await expect(page.locator('#fetch-osm')).toHaveText('Retry trails and water', {
    timeout: 15_000,
  });
  expect(attempts).toBe(4);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.triangles)).toBeGreaterThan(
    0,
  );
  expect(await page.evaluate(() => (window as any).contourDiagnostics.busy)).toBe(false);
  await expect(page.locator('#generate')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('Your terrain is ready');

  recover = true;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toHaveText('Pull from OpenStreetMap');
  await expect(page.locator('#status')).toContainText('Added 1 map feature');
  await expect(page.locator('#feature-list')).toContainText('Recovered trail');
});

test('leaving a project cancels Overpass work and suppresses its stale response', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  await page.route('**/api/interpreter', async route => {
    await new Promise(resolve => setTimeout(resolve, 600));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          elements: [
            {
              type: 'way',
              id: 9002,
              tags: { highway: 'path', name: 'Stale trail' },
              geometry: [
                { lon: 0.003, lat: 0.006 },
                { lon: 0.007, lat: 0.006 },
              ],
            },
          ],
        }),
      });
    } catch {
      // The navigation intentionally aborts this request.
    }
  });
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: /^Features/, exact: false }).tap();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toContainText('Loading trails and water');
  await page.locator('#mobile-close').tap();
  await page.locator('#show-projects').tap();
  await expect(page.locator('#landing-dialog')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.osmLoading)).toBe(false);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.features)).toBe(2);
});

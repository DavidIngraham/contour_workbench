import { expect, test, type Page } from '@playwright/test';
import { defaults } from '../src/types';

async function fixture(page: Page) {
  await page.goto('/');
  await page.locator('#file-project').setInputFiles({
    name: 'ui.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: 2,
        name: 'Workflow review',
        grid: { bounds: [0, 0, 0.001, 0.001], width: 3, height: 3, elevations: Array(9).fill(100) },
        source: { product: 'test', name: 'Fixture', attribution: 'Test', retrieved: '2026-11-06' },
        settings: { ...defaults, max_print_size_mm: [100, 100], bed_rotation_deg: 0 },
        features: [
          {
            id: 'lake',
            name: 'Lake',
            class: 'water',
            treatment: 'insert',
            enabled: true,
            tags: {},
            lines: [],
            polygons: [
              {
                outer: [
                  [0.0002, 0.0002],
                  [0.0008, 0.0002],
                  [0.0008, 0.0008],
                  [0.0002, 0.0008],
                ],
                holes: [
                  [
                    [0.000495, 0.000495],
                    [0.000505, 0.000495],
                    [0.000505, 0.000505],
                    [0.000495, 0.000505],
                  ],
                ],
              },
            ],
          },
          ...Array.from({ length: 15 }, (_, i) => ({
            id: `trail-${i}`,
            name: 'Ridge',
            class: 'trail',
            treatment: 'v_carve',
            enabled: i !== 0,
            tags: {},
            lines: [
              [
                [0.0001, 0.00005 + i * 0.00001],
                [0.0009, 0.00005 + i * 0.00001],
              ],
            ],
          })),
        ],
      }),
    ),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
}
async function closeSheet(page: Page) {
  if (await page.locator('#mobile-close').isVisible()) await page.locator('#mobile-close').click();
}

test('search moves the draft boundary, tile failures are recoverable, and cancel returns to the model', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  let queries = 0;
  await page.route('**/nominatim.openstreetmap.org/search?**', route => {
    queries++;
    return route.fulfill({
      json: [
        {
          display_name: 'Mount Hood, Oregon',
          lat: '45.37',
          lon: '-121.69',
          boundingbox: ['45.3', '45.4', '-121.8', '-121.6'],
        },
      ],
    });
  });
  await page
    .locator('.command-menu > summary')
    .filter({ hasText: /^File$/ })
    .click();
  await page.locator('#new-project').click();
  await expect(page.locator('#area-dialog')).toHaveAttribute('data-ready', 'true');
  await page.locator('#location-query').fill('Mount Hood');
  expect(queries).toBe(0);
  await page.locator('#location-submit').click();
  await page.getByRole('button', { name: 'Mount Hood, Oregon', exact: true }).click();
  await expect(page.locator('#location-status')).toContainText('Boundary moved');
  expect(Number(await page.locator('#west').inputValue())).toBeCloseTo(-121.696, 2);
  await expect(page.locator('#map-tile-retry')).toBeVisible();
  await page.locator('#map-tile-retry').click();
  await page.locator('#location-query').fill('46, -122');
  await page.locator('#location-submit').click();
  await page.locator('.location-result').click();
  expect(queries).toBe(1);
  await page.locator('#area-close').click();
  await expect(page.locator('#landing-dialog')).toBeHidden();
  await expect(page.locator('#generate')).toBeEnabled();
});

test('large classes start collapsed, filters preserve inclusion, and print controls show actual size', async ({
  page,
}, info) => {
  await fixture(page);
  await page.locator('[data-tab="features"]').click();
  await expect(page.locator('[data-tree-key="trail"]')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-tree-key="trail"] > summary')).toContainText('14/15 included');
  await page.locator('#feature-expand').click();
  await page.locator('[data-tree-key="trail"] .feature-source-group > summary').click();
  await page.locator('#feature-inclusion').selectOption('excluded');
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('[data-feature="trail-0"]')).toContainText('Segment 1');
  await expect(page.locator('[data-feature="trail-0"]')).toBeVisible();
  await page.locator('[data-select-feature="trail-0"]').click();
  await expect(page.locator('#selection-included')).not.toBeChecked();
  await page.locator('#feature-treatment').selectOption('insert');
  await expect(page.locator('#feature-list')).toContainText('No matching features');
  await page.locator('[data-tab="print"]').click();
  await expect(page.locator('#bed-width')).toBeVisible();
  await expect(page.locator('#print-fit-summary')).toContainText('Actual model: 100.0');
  await expect(page.locator('[data-material-row="road"]')).toBeHidden();
  await page.locator('#unused-materials-group summary').click();
  await expect(page.locator('[data-material-row="road"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('print-setup.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('generation promotes export and exposes selectable parts and exact correction outlines', async ({
  page,
}, info) => {
  await fixture(page);
  await closeSheet(page);
  await page.locator('#generate').click();
  await expect(page.locator('#download')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#download')).toHaveClass(/primary/);
  await expect(page.locator('#generate')).not.toHaveClass(/primary/);
  await page.locator('[data-tab="inspect"]').click();
  await expect(page.locator('#asset-summary')).toContainText('narrow terrain pins removed');
  await page.locator('#show-corrections').check();
  await page.getByRole('button', { name: /Water insert 1/ }).click();
  await expect(page.getByRole('button', { name: /Water insert 1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#isolate-part').check();
  await page.locator('#show-all-parts').click();
  await expect(page.locator('#isolate-part')).not.toBeChecked();
  await closeSheet(page);
  await page.screenshot({ path: info.outputPath('inspection.png') });
  await page.locator('[data-tab="terrain"]').click();
  await page.locator('#base-height').fill('2');
  await page.locator('#base-height').dispatchEvent('input');
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#generate')).toHaveText('Update model');
});

test('compact mobile controls leave the annotation canvas interactive', async ({ page }, info) => {
  test.skip(page.viewportSize()!.width > 760, 'Mobile sheet behavior');
  await fixture(page);
  await page.locator('[data-tab="annotations"]').click();
  const canvas = await page.locator('#viewport').boundingBox();
  const sheet = await page.locator('#settings-panel').boundingBox();
  expect(canvas!.height).toBeGreaterThan(100);
  expect(
    canvas!.y + canvas!.height <= sheet!.y + 2 || canvas!.x + canvas!.width <= sheet!.x + 2,
  ).toBe(true);
  expect(await page.locator('.stage').evaluate(element => (element as HTMLElement).inert)).toBe(
    false,
  );
  await page.locator('#add-text').click();
  await expect(page.locator('#ann-text')).toBeVisible();
  await page.locator('#mobile-expand').click();
  await expect(page.locator('#mobile-expand')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#mobile-expand').click();
  await page.screenshot({ path: info.outputPath('mobile-annotations.png') });
});

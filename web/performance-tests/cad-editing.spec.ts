import { expect, test } from '@playwright/test';
import { defaults } from '../src/types';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error(error));
  await page.goto('/');
  await page.locator('#file-project').setInputFiles({
    name: 'cad.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: 2,
        name: 'CAD regression',
        grid: { bounds: [0, 0, 0.001, 0.001], width: 3, height: 3, elevations: Array(9).fill(100) },
        source: { name: 'Fixture', product: 'test', attribution: 'Test', retrieved: '2026-11-03' },
        features: [],
        settings: { ...defaults, max_print_size_mm: [100, 100], base_height_mm: 12 },
      }),
    ),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
});

test('narrow insert failure selects the annotation and clears when artwork changes', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.locator('#add-text').click();
  await page.locator('#ann-text').fill('III');
  await page.locator('[data-ann-number="width_mm"]').fill('0.6');
  await page.locator('#ann-treatment').selectOption('insert');
  await page.locator('#generate').click();
  await expect(page.locator('#annotation-warning')).toContainText('Red regions are too narrow', {
    timeout: 30000,
  });
  await expect(page.locator('#tab-annotations')).toBeVisible();
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('[data-ann-number="width_mm"]').fill('35');
  await expect(page.locator('#annotation-warning')).toBeEmpty();
});

test('side dragging crosses corners and unsupported portions stay editable', async ({ page }) => {
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.locator('#add-text').click();
  await page.locator('#ann-placement').selectOption('side');
  await page.locator('#ann-perimeter').evaluate((input: HTMLInputElement) => {
    input.value = '150';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(
    await page.evaluate(() => (window as any).contourDiagnostics.annotations[0].side_index),
  ).toBe(1);
  await page.locator('#ann-perimeter').evaluate((input: HTMLInputElement) => {
    input.value = '250';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(
    await page.evaluate(() => (window as any).contourDiagnostics.annotations[0].side_index),
  ).toBe(2);
  await page.locator('[data-ann-number="z_mm"]').fill('13');
  await expect(page.locator('#annotation-warning')).toContainText('Ghosted areas');
  await expect(page.locator('#ann-view')).toBeEnabled();
  await page.locator('[data-ann-number="z_mm"]').fill('6');
  await expect(page.locator('#annotation-warning')).toBeEmpty();
});

test('manual bed rotation persists and boundary edits restore automatic fitting', async ({
  page,
}) => {
  await page.locator('[data-tab="print"]').click();
  await page.locator('#bed-rotation').fill('35');
  await page.locator('#bed-rotation').press('Tab');
  await expect(page.locator('#bed-fit-mode')).toHaveText('Manual angle');
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await page.locator('[data-tab="terrain"]').click();
  await page.locator('#change-area').click();
  await expect(page.locator('#area-dialog')).toHaveAttribute('data-ready', 'true');
  await page.locator('#extent-shape').selectOption('freeform');
  const before = await page.locator('.extent-vertex:not(.extent-midpoint)').count();
  await page.locator('.extent-midpoint').first().click();
  await expect(page.locator('.extent-vertex')).toHaveCount(before + 1);
  await page.locator('#polygon-remove').click();
  await expect(page.locator('.extent-vertex')).toHaveCount(before);
  await page.locator('#polygon-draw').click();
  await page.locator('#extent-map').press('Escape');
  await expect(page.locator('#area-dialog')).toBeVisible();
  await expect(page.locator('.extent-vertex')).toHaveCount(before);
  await page.locator('#area-reuse').click();
  await page.locator('[data-tab="print"]').click();
  await expect(page.locator('#bed-fit-mode')).toContainText('Auto fit');
});

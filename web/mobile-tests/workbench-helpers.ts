import { defaults } from '../src/types';
import type { Locator, Page } from '@playwright/test';

/** Open source management through the feature browser, retaining the current project. */
export async function openSources(page: Page) {
  if (await page.locator('#sources-dialog').evaluate((el: HTMLDialogElement) => el.open)) return;
  await page.getByRole('button', { name: 'Add features…', exact: true }).click();
}

/** Return from source management to editing features. */
export async function closeSources(page: Page) {
  if (await page.locator('#sources-dialog').evaluate((el: HTMLDialogElement) => el.open))
    await page.locator('#sources-dialog [data-close-dialog]').click();
}

/** Invoke a File command using the same menu as the user. */
export async function fileCommand(page: Page, id: string) {
  await closeSources(page);
  if ((await page.locator('#mobile-settings').getAttribute('aria-expanded')) === 'true')
    await page.locator('#mobile-close').click();
  await page
    .locator('.command-menu > summary')
    .filter({ hasText: /^File$/ })
    .click();
  await page.locator(`#${id}`).click();
}

/** Select a feature before editing its shared properties panel. */
export async function selectFeature(page: Page, row: Locator) {
  await closeSources(page);
  await row.locator('[data-select-feature]').click();
}

/** Open fit calibration through Print setup using a small local terrain fixture. */
export async function openCalibration(page: Page) {
  await page.goto('/');
  await page.locator('#file-project').setInputFiles({
    name: 'calibration.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: 2,
        name: 'Calibration setup',
        grid: { bounds: [0, 0, 0.001, 0.001], width: 3, height: 3, elevations: Array(9).fill(100) },
        settings: defaults,
        features: [],
        source: { product: 'test', name: 'Fixture', attribution: 'Test', retrieved: '2026-11-06' },
      }),
    ),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.locator('[data-tab="print"]').click();
  await page.locator('[data-command="download-calibration"]').click();
}

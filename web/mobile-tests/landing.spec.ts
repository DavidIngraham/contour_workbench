import { test, expect } from '@playwright/test';

test('landing catalog and new-project wizard fit the mobile viewport', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await expect(page.locator('[data-preset]')).toHaveCount(2);
  await expect(page.locator('#preset-new')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const modal = await page.locator('.landing-modal').boundingBox();
  expect(modal!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.locator('#preset-new').tap();
  await page.waitForFunction(() => (window as any).contourDiagnostics?.wizardStep === 1);
  await expect(page.locator('#area-dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('fit-test printer choice and download remain reachable on small screens', async ({
  page,
}, testInfo) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#landing-calibration').tap();
  await page.locator('#fit-download-format').selectOption('bambu');
  await page.locator('#fit-bambu-printer').selectOption('a1-mini');
  const dialog = await page.locator('#fit-download-dialog .download-modal').boundingBox();
  expect(dialog!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.locator('#fit-download-confirm').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('fit-printer-choice.png') });
  const pending = page.waitForEvent('download');
  await page.locator('#fit-download-confirm').tap();
  expect((await pending).suggestedFilename()).toBe('Contour Workbench fit test.3mf');
});

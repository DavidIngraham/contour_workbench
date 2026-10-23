import { expect, test } from '@playwright/test';

test('coupon settings and unit labels are usable without loading a project', async ({ page }) => {
  await page.goto('/');
  await page.locator('#landing-calibration').click();
  await expect(page.locator('#coupon-path_width_mm')).toHaveValue('0.9');
  await expect(page.locator('#coupon-label-preview')).toContainText('0.15 MM');
  await page.locator('#coupon-clearance-2').fill('0.1');
  await expect(page.locator('#coupon-error')).toContainText('four increasing clearances');
  await expect(page.locator('#fit-download-confirm')).toBeDisabled();
  await page.locator('#coupon-clearance-2').fill('0.12');
  await page.locator('#coupon-insert_draft_angle_deg').fill('10');
  await expect(page.locator('#coupon-error')).toContainText('too little material');
  await page.locator('#coupon-insert_draft_angle_deg').fill('1');
  await expect(page.locator('#fit-download-confirm')).toBeEnabled();
  await expect(page.locator('#coupon-label-preview')).toContainText('DRAFT 1.00 DEG');
  const modal = page.locator('#fit-download-dialog .modal');
  expect(await modal.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.locator('#fit-download-confirm').scrollIntoViewIfNeeded();
  await expect(page.locator('#fit-download-confirm')).toBeInViewport();
  await page.screenshot({ path: `../temp/coupon-dialog-${test.info().project.name}.png` });
  await page.locator('#fit-download-cancel').click();
  await expect(page.locator('#landing-calibration')).toBeFocused();
});

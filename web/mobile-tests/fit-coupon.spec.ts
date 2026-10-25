import { expect, test } from '@playwright/test';

test('coupon settings and unit labels are usable without loading a project', async ({ page }) => {
  await page.goto('/');
  await page.locator('#landing-calibration').click();
  await expect(page.locator('#coupon-path_width_mm')).toHaveValue('0.9');
  await expect(page.locator('#coupon-label-preview')).toContainText('0.15 MM');
  await expect(page.locator('#coupon-size')).toContainText('88.0 × 20.0 mm');
  await expect(page.locator('#fit-download-dialog')).toContainText('Labels engraved underneath');
  await expect(page.getByLabel('Coupon / insert thickness (mm)', { exact: true })).toHaveValue('2');
  await page.locator('#coupon-insert_depth_mm').fill('5');
  await expect(page.locator('#fit-download-confirm')).toBeEnabled();
  await expect(page.locator('#coupon-insert_draft_angle_deg')).toBeHidden();
  await expect(page.locator('#coupon-insert_elephant_foot_relief_mm')).toBeHidden();
  await expect(page.locator('#coupon-label-preview')).not.toContainText('DRAFT');
  await expect(page.locator('#coupon-label-preview')).not.toContainText('FOOT');
  await expect(page.locator('#coupon-size')).toContainText('total height 10.00 mm');
  await expect(page.locator('#fit-download-dialog')).toContainText(
    'same Mt. Hood Meadows terrain patch',
  );
  await expect(page.locator('#coupon-label-preview')).toContainText('MIN INSERT 5.00 MM');
  await expect(page.locator('#coupon-label-preview')).toContainText('RELIEF 4.00 MM');
  await expect(page.locator('#coupon-floor-thickness')).toHaveValue('1');
  await page.locator('#coupon-insert_depth_mm').fill('2');
  await page.locator('#coupon-advanced > summary').click();
  await page.locator('#coupon-floor-thickness').fill('5');
  await expect(page.locator('#coupon-label-preview')).toContainText('FLOOR 5.00 MM');
  await expect(page.locator('#coupon-size')).toContainText('total height 11.00 mm');
  await page.locator('#coupon-floor-thickness').fill('0');
  await expect(page.locator('#fit-download-confirm')).toBeDisabled();
  await page.locator('#coupon-floor-thickness').fill('5');
  await page.locator('#coupon-clearance-2').fill('0.1');
  await expect(page.locator('#coupon-error')).toContainText('four increasing clearances');
  await expect(page.locator('#fit-download-confirm')).toBeDisabled();
  await page.locator('#coupon-clearance-2').fill('0.12');
  await page.locator('#coupon-insert_draft_angle_deg').fill('10');
  await expect(page.locator('#coupon-error')).toContainText('too little material');
  await page.locator('#coupon-insert_draft_angle_deg').fill('1');
  await expect(page.locator('#fit-download-confirm')).toBeEnabled();
  await expect(page.locator('#coupon-insert_draft_angle_deg')).toHaveValue('1');
  await expect(page.locator('#coupon-label-preview')).not.toContainText('DRAFT');
  const modal = page.locator('#fit-download-dialog .modal');
  expect(await modal.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.locator('#fit-download-confirm').scrollIntoViewIfNeeded();
  await expect(page.locator('#fit-download-confirm')).toBeInViewport();
  await page.screenshot({ path: `../temp/coupon-dialog-${test.info().project.name}.png` });
  await page.locator('#fit-download-cancel').click();
  await expect(page.locator('#landing-calibration')).toBeFocused();
});

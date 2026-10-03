import { test, expect } from '@playwright/test';

test('preset changes become a durable recent project with a thumbnail', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  await page.goto('/?preset=post-canyon');
  await page.waitForFunction(
    () =>
      Boolean((window as any).contourDiagnostics?.triangles) &&
      !(window as any).contourDiagnostics.busy,
  );

  await page.locator('#show-projects').tap();
  await expect(page.locator('#recent-section')).toBeHidden();

  await page.locator('[data-preset="post-canyon"]').tap();
  await page.waitForFunction(
    () =>
      Boolean((window as any).contourDiagnostics?.triangles) &&
      !(window as any).contourDiagnostics.busy,
  );
  await page.locator('#mobile-settings').tap();
  await page.locator('#base-height').fill('1.1');
  await expect(page.locator('#save-status')).toHaveText('Saved locally', { timeout: 30_000 });
  await page.locator('#mobile-close').tap();

  await page.locator('#show-projects').tap();
  await expect(page.locator('#recent-section')).toBeVisible();
  await expect(page.locator('[data-local-project]')).toHaveCount(1);
  const thumbnail = page.locator('[data-local-project] img');
  await expect(thumbnail).toBeVisible();
  expect(await thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(640);

  await page.reload();
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await expect(page.locator('[data-local-project]')).toHaveCount(1);
  await page.locator('[data-local-open]').tap();
  await page.waitForFunction(
    () =>
      Boolean((window as any).contourDiagnostics?.triangles) &&
      !(window as any).contourDiagnostics.busy,
  );
  await page.locator('#mobile-settings').tap();
  await expect(page.locator('#base-height')).toHaveValue('1.1');
  await page.locator('#mobile-close').tap();

  await page.locator('#show-projects').tap();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-local-delete]').tap();
  await expect(page.locator('#recent-section')).toBeHidden();
});

import { expect, test } from '@playwright/test';

test('full terrain example keeps selection properties and menus usable across viewport sizes', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?preset=post-canyon');
  await page.waitForFunction(
    () =>
      (window as any).contourDiagnostics?.previewStage === 'features' &&
      !(window as any).contourDiagnostics.busy,
  );
  await expect(page.locator('#project-title')).toHaveText('Post Canyon, Oregon');
  await page.screenshot({ path: info.outputPath('desktop-terrain.png') });
  await page.locator('[data-tab="features"]').click();
  await page.locator('[data-select-feature]').first().click();
  await expect(page.locator('#selection-treatment')).toBeVisible();
  const tree = await page.locator('#feature-list').boundingBox();
  expect(tree!.height).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath('desktop-features.png') });
  for (const size of [
    { width: 800, height: 900 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator('#generate')).toBeInViewport();
    await expect(page.locator('#download')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const menu of await page.locator('.command-menu > summary').all()) {
      await menu.click();
      const popup = await page.locator('.command-menu[open] .command-popup').boundingBox();
      expect(popup!.x).toBeGreaterThanOrEqual(0);
      expect(popup!.x + popup!.width).toBeLessThanOrEqual(size.width);
      await page.keyboard.press('Escape');
    }
    await page.screenshot({ path: info.outputPath(`workbench-${size.width}.png`) });
  }
});

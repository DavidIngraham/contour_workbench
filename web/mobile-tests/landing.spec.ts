import {test,expect} from '@playwright/test';

test('landing catalog and new-project wizard fit the mobile viewport',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>(window as any).contourDiagnostics?.landingOpen);
 await expect(page.locator('[data-preset]')).toHaveCount(2);await expect(page.locator('#preset-new')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const modal=await page.locator('.landing-modal').boundingBox();expect(modal!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
 await page.locator('#preset-new').tap();await page.waitForFunction(()=>(window as any).contourDiagnostics?.wizardStep===1);
 await expect(page.locator('#area-dialog')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

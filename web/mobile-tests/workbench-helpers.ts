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

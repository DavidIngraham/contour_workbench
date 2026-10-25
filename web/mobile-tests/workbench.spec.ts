import { expect, test } from '@playwright/test';
import { defaults, type Project } from '../src/types';

const fixture: Project = {
  schema_version: 2,
  name: 'Workbench fixture',
  grid: { bounds: [0, 0, 0.01, 0.01], width: 5, height: 5, elevations: Array(25).fill(100) },
  source: {
    product: 'fixture',
    name: 'Test elevation',
    attribution: 'Test',
    retrieved: '2026-10-25',
  },
  settings: { ...defaults, max_print_size_mm: [100, 100], manufacturing_mode: 'multicolor' },
  features: ['Alpha trail', 'Beta trail'].map((name, i) => ({
    id: `osm:way:${i}`,
    name,
    class: 'trail',
    enabled: true,
    treatment: 'insert',
    tags: {},
    lines: [
      [
        [0.002, 0.003 + i * 0.004],
        [0.008, 0.003 + i * 0.004],
      ],
    ],
  })),
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'workbench.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
});

test('menus support keyboard navigation, view toggles, dialogs, and project export', async ({
  page,
}) => {
  const view = page.locator('.command-menu > summary').filter({ hasText: /^View$/ });
  await view.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-command="fit-view"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('[data-command="wireframe"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#wireframe')).toHaveAttribute('aria-pressed', 'true');
  await view.click();
  await expect(page.locator('[data-command="wireframe"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(view).toBeFocused();
  await expect(page.locator('.command-menu[open]')).toHaveCount(0);
  await page
    .locator('.command-menu > summary')
    .filter({ hasText: /^Help$/ })
    .click();
  await page.getByRole('button', { name: 'Storage and offline use…' }).click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await expect(page.locator('#storage-help')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-dialog')).toBeHidden();
  await page
    .locator('.command-menu > summary')
    .filter({ hasText: /^File$/ })
    .click();
  const pending = page.waitForEvent('download');
  await page.locator('#save-project').click();
  expect((await pending).suggestedFilename()).toBe('Workbench fixture.contour.json');
});

test('selection properties distinguish filtered and complete groups and retain inclusion', async ({
  page,
}, info) => {
  await page.locator('#mobile-settings').click();
  await page.locator('[data-tab="features"]').click();
  await page.locator('[data-select-class="trail"]').click();
  await expect(page.locator('#selection-treatment')).toHaveText(/Color region/);
  await page.locator('#feature-search').fill('Alpha');
  await expect(page.locator('#feature-list [data-feature]')).toHaveCount(1);
  await expect(page.locator('#feature-properties')).toContainText(
    'including members hidden by search',
  );
  await page.locator('#selection-scope').selectOption('results');
  await page.locator('#selection-treatment').selectOption('v_carve');
  await page.locator('#feature-search').fill('');
  await page.getByRole('button', { name: 'Beta trail', exact: true }).click();
  await expect(page.locator('#selection-treatment')).toHaveValue('insert');
  await page.getByRole('button', { name: 'Alpha trail', exact: true }).click();
  await expect(page.locator('#selection-treatment')).toHaveValue('v_carve');
  await page.locator('#selection-included').uncheck();
  await page.locator('#selection-included').check();
  await expect(page.locator('#selection-treatment')).toHaveValue('v_carve');
  await page.locator('#feature-search').fill('Beta');
  await expect(page.locator('#all-features')).toHaveText('Exclude 1 result');
  await page.locator('#all-features').click();
  await expect(page.locator('#enabled-count')).toHaveText('1');
  await page.locator('#feature-search').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('feature-properties.png') });
});

test('source management is focused and export becomes unavailable after model edits', async ({
  page,
}, info) => {
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#mobile-settings').click();
  await page.locator('[data-tab="features"]').click();
  await page.getByRole('button', { name: 'Add features…', exact: true }).click();
  await expect(page.locator('#sources-dialog')).toBeVisible();
  expect(
    await page.locator('#sources-dialog').evaluate(el => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.locator('#sources-dialog [data-close-dialog]').click();
  await page.locator('#mobile-close').click();
  await page.locator('#generate').click();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await expect(page.locator('#download')).toBeEnabled();
  await expect(page.locator('#mode-review')).toHaveClass(/active/);
  await page.locator('#mobile-settings').click();
  await expect(page.locator('#tab-inspect')).toBeVisible();
  await expect(page.locator('#asset-summary')).toContainText('Validated solid geometry');
  await page.locator('[data-tab="terrain"]').click();
  await page.locator('#base-height').fill('2');
  await page.locator('#base-height').dispatchEvent('input');
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#export-reason')).toContainText('Model changed');
  await page.locator('[data-tab="inspect"]').click();
  await expect(page.locator('#asset-summary')).toContainText('design changed');
  await expect(page.locator('#review-controls')).toBeHidden();
  await page.locator('#mobile-close').click();
  await page.screenshot({ path: info.outputPath('workbench.png') });
});

test('desktop panels and command bar remain compact', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#project-title')).toHaveText('Workbench fixture');
  await expect(page.locator('.command-menu > summary')).toHaveText([
    'File',
    'View',
    'Model',
    'Tools',
    'Help',
  ]);
  await page.locator('[data-tab="features"]').click();
  await page.getByRole('button', { name: 'Alpha trail', exact: true }).click();
  await expect(page.locator('#selection-treatment')).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop-features.png') });
  await page.locator('[data-tab="print"]').click();
  await expect(page.locator('#fit-clearance')).toBeHidden();
  await page.locator('#manufacturing-mode').selectOption('separate');
  await expect(page.locator('#fit-clearance')).toBeVisible();
  await expect(page.locator('#draft-angle')).toBeHidden();
  await page.getByText('Advanced insert fit', { exact: true }).click();
  await expect(page.locator('#draft-angle')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

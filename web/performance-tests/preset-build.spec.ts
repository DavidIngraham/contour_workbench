import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

const completionTimeoutMs = 12 * 60 * 1000;
for (const preset of [
  { id: 'post-canyon', name: 'Post Canyon' },
  { id: 'mt-hood-meadows', name: 'Mt. Hood Meadows' },
]) {
  test(`${preset.name} builds a watertight asset`, async ({ page }) => {
    await page.goto('/?preset=' + preset.id);
    await page.waitForFunction(
      () =>
        Boolean((window as any).contourDiagnostics?.triangles) &&
        !(window as any).contourDiagnostics.busy,
      null,
      { timeout: 120000 },
    );
    const started = Date.now();
    await page.locator('#generate').click();
    await page.waitForFunction(
      () =>
        !(window as any).contourDiagnostics.busy &&
        ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
      null,
      { timeout: completionTimeoutMs },
    );
    const elapsedMs = Date.now() - started,
      status = await page.locator('#status').innerText(),
      asset = await page.evaluate(() => (window as any).contourDiagnostics.asset);
    expect(await page.locator('#status.error').count(), status).toBe(0);
    expect(asset?.watertight, status).toBe(true);
    expect(asset?.removed_terrain_islands, status).toBeGreaterThanOrEqual(0);
    if (preset.id === 'post-canyon')
      expect(asset.removed_terrain_islands, status).toBeGreaterThan(0);
    console.log(
      `${preset.name}: ${(elapsedMs / 1000).toFixed(1)} s, ${asset.pieces} insert pieces, ${asset.triangles} terrain triangles, ${asset.removed_terrain_islands} terrain pins removed`,
    );
  });
}

test('Post Canyon builds one painted exterior', async ({ page }) => {
  await page.goto('/?preset=post-canyon');
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
    null,
    { timeout: 120000 },
  );
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  await page.locator('#manufacturing-mode').selectOption('multicolor');
  await page.waitForFunction(() => !(window as any).contourDiagnostics.overlayBusy);
  await expect(page.locator('#insert-depth')).toBeDisabled();
  await page.locator('#generate').click();
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics.busy &&
      ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
    null,
    { timeout: completionTimeoutMs },
  );
  const status = await page.locator('#status').innerText();
  expect(await page.locator('#status.error').count(), status).toBe(0);
  const asset = await page.evaluate(() => (window as any).contourDiagnostics.asset);
  expect(asset?.watertight, status).toBe(true);
  expect(asset?.pieces, status).toBe(0);
  await expect(page.locator('#asset-summary')).toContainText('One painted exterior mesh');
  await page.locator('#download').click();
  await page.locator('input[value="3mf"]').check();
  await page.locator('#export-slicer').selectOption('bambu');
  const pending = page.waitForEvent('download');
  await page.locator('#download-confirm').click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const model = strFromU8(unzipSync(bytes)['3D/Objects/object_1.model']);
  const parents = Uint32Array.from(
    { length: [...model.matchAll(/<vertex /g)].length },
    (_, i) => i,
  );
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const triangles = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(match =>
    match.slice(1).map(Number),
  );
  for (const [a, b, c] of triangles) {
    parents[find(b)] = find(a);
    parents[find(c)] = find(a);
  }
  expect(
    new Set(triangles.map(([a]) => find(a))).size,
    'Painted export must have one connected exterior, without internal shells',
  ).toBe(1);
  await mkdir('../temp/painted-validation', { recursive: true });
  await writeFile('../temp/painted-validation/post-canyon.3mf', bytes);
});

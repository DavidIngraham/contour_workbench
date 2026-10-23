import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults, type Project, type Feature } from '../src/types';

test('class priority reorders the tree, resets, and survives saving and reopening', async ({
  page,
}, testInfo) => {
  const project: Project = {
    schema_version: 2,
    name: 'Class priority',
    grid: { bounds: [0, 0, 0.01, 0.01], width: 5, height: 5, elevations: Array(25).fill(100) },
    source: {
      product: 'fixture',
      name: 'Flat terrain',
      attribution: 'Test',
      retrieved: '2026-10-23',
    },
    settings: { ...defaults, max_print_size_mm: [100, 100] },
    features: ['trail', 'road', 'water'].map((cls, id) => ({
      id: `osm:way:${id}`,
      name: `${cls} feature`,
      class: cls as Feature['class'],
      enabled: true,
      treatment: 'insert',
      tags: {},
      lines: [
        [
          [0.002, 0.005],
          [0.008, 0.005],
        ],
      ],
    })),
  };
  const open = async (model: Project) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
    await page.locator('#file-project').setInputFiles({
      name: 'priority.contour.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(model)),
    });
    await page.waitForFunction(
      () =>
        (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
    );
    await page.locator('#mobile-settings').tap();
    await page.getByRole('button', { name: /^Features/ }).tap();
  };
  await open(project);
  await page.locator('#class-priority summary').tap();
  await expect(
    page.getByRole('button', { name: 'Move Lakes & rivers up', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Move Ski lifts down', exact: true }),
  ).toBeDisabled();
  const tree = page.locator('.group-heading > span');
  await expect(tree).toHaveText(['Lakes & rivers', 'Trails', 'Roads']);
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: 'Move Roads up', exact: true }).tap();
  await expect(tree).toHaveText(['Roads', 'Lakes & rivers', 'Trails']);
  await expect(page.getByRole('button', { name: 'Move Roads up', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Roads down', exact: true }).tap();
  await expect(tree).toHaveText(['Lakes & rivers', 'Roads', 'Trails']);
  await page.locator('#reset-class-priority').tap();
  await expect(tree).toHaveText(['Lakes & rivers', 'Trails', 'Roads']);
  for (let i = 0; i < 4; i++)
    await page.getByRole('button', { name: 'Move Roads up', exact: true }).tap();
  await page.locator('#class-priority-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('class-priority.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#mobile-close').tap();
  const pending = page.waitForEvent('download');
  await page.locator('#save-project').tap();
  const saved = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(saved.settings.class_priority).toEqual([
    'road',
    'water',
    'glacier',
    'ski_run',
    'trail',
    'stream',
    'ski_lift',
  ]);
  await open(saved);
  await expect(tree).toHaveText(['Roads', 'Lakes & rivers', 'Trails']);
});

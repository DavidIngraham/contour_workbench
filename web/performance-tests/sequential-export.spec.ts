import { mkdir, readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { defaults, type Project } from '../src/types';

test('regular export uses the selected printer and preserves terrain after calibration', async ({
  page,
}) => {
  const project: Project = {
    schema_version: 2,
    name: 'Sequential terrain',
    grid: {
      bounds: [0, 0, 0.001, 0.001],
      width: 9,
      height: 9,
      elevations: Array.from({ length: 81 }, (_, i) => 100 + (i % 9) * 2),
    },
    source: {
      product: 'fixture',
      name: 'Sloped reference',
      attribution: 'Test',
      retrieved: '2026-10-11',
    },
    settings: { ...defaults, max_print_size_mm: [140, 140], base_height_mm: 3 },
    features: [0.00025, 0.00065].map((x, i) => ({
      id: `lake-${i}`,
      class: 'water',
      name: `Lake ${i}`,
      enabled: true,
      treatment: 'insert',
      lines: [],
      tags: {},
      polygons: [
        {
          outer: [
            [x, 0.0003],
            [x + 0.00015, 0.0003],
            [x + 0.00015, 0.0005],
            [x, 0.0005],
            [x, 0.0003],
          ],
          holes: [],
        },
      ],
    })),
  };
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'sequential.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  await page.locator('#download-calibration').click();
  const couponDownload = page.waitForEvent('download');
  await page.locator('#fit-download-confirm').click();
  await couponDownload;
  await page.locator('#generate').click();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  expect(
    await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight),
    await page.locator('#status').innerText(),
  ).toBe(true);
  await page.locator('#download').click();
  await page.locator('input[value="3mf"]').check();
  await page.locator('#export-slicer').selectOption('bambu');
  await page.locator('#export-bambu-printer').selectOption('a1-mini');
  const pending = page.waitForEvent('download');
  await page.locator('#download-confirm').click();
  const download = await pending;
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
  expect(settings).toMatchObject({
    printer_settings_id: 'Bambu Lab A1 mini 0.4 nozzle',
    print_sequence: 'by object',
  });
  const manifest = JSON.parse(strFromU8(files['Metadata/contour_workbench.json']));
  expect(manifest.plates).toHaveLength(2);
  expect(manifest.plates.flatMap((plate: any) => plate.objects)).toHaveLength(3);
  const models = Object.entries(files).filter(([name]) => name.startsWith('3D/Objects/'));
  const maxX = Math.max(
    ...models.flatMap(([, bytes]) =>
      [...strFromU8(bytes).matchAll(/<vertex x="([^"]+)"/g)].map(m => Number(m[1])),
    ),
  );
  expect(maxX).toBeCloseTo(140, 2);
  await mkdir('../temp', { recursive: true });
  await download.saveAs('../temp/sequential-a1-mini.3mf');
});

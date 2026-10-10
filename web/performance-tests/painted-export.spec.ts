import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { defaults, type Project } from '../src/types';

for (const offset of [0, 0.35, -0.3]) {
  test(`painted exterior exports three filament regions at height ${offset}`, async ({
    page,
  }, testInfo) => {
    const project: Project = {
      schema_version: 2,
      name: `Painted terrain ${offset}`,
      grid: { bounds: [0, 0, 0.001, 0.001], width: 9, height: 9, elevations: Array(81).fill(100) },
      source: {
        product: 'fixture',
        name: 'Flat reference terrain',
        attribution: 'Test',
        retrieved: '2026-10-10',
      },
      settings: {
        ...defaults,
        manufacturing_mode: 'multicolor',
        max_print_size_mm: [60, 60],
        base_height_mm: 3,
        path_width_mm: 3,
        insert_relative_height_mm: offset,
      },
      materials: [
        { id: 'terrain', name: 'Terrain', color: '#228833', extruder: 1 },
        { id: 'trail', name: 'Trail', color: '#DD4422', extruder: 2 },
        { id: 'water', name: 'Lake', color: '#2266DD', extruder: 3 },
      ],
      features: [
        {
          id: 'stripe',
          class: 'trail',
          name: 'Straight trail',
          enabled: true,
          treatment: 'insert',
          lines: [
            [
              [0.0001, 0.0003],
              [0.0009, 0.0003],
            ],
          ],
          tags: {},
        },
        {
          id: 'lake',
          class: 'water',
          name: 'Square lake',
          enabled: true,
          treatment: 'insert',
          lines: [],
          polygons: [
            {
              outer: [
                [0.0002, 0.0006],
                [0.0004, 0.0006],
                [0.0004, 0.0008],
                [0.0002, 0.0008],
                [0.0002, 0.0006],
              ],
              holes: [],
            },
          ],
          tags: {},
        },
      ],
    };
    await page.goto('/');
    await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
    await page.locator('#file-project').setInputFiles({
      name: 'painted.contour.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.waitForFunction(
      () =>
        (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
    );
    await page.locator('#generate').click();
    await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
    expect(
      await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight),
      await page.locator('#status').innerText(),
    ).toBe(true);
    expect(await page.evaluate(() => (window as any).contourDiagnostics.asset?.pieces)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('painted-review.png') });
    await page.locator('#download').click();
    await page.locator('input[value="3mf"]').check();
    await page.locator('#export-slicer').selectOption('bambu');
    const pending = page.waitForEvent('download');
    await page.locator('#download-confirm').click();
    const download = await pending;
    const bytes = await readFile((await download.path())!);
    const files = unzipSync(bytes);
    const objects = Object.keys(files).filter(path => /^3D\/Objects\/.*\.model$/.test(path));
    expect(objects).toHaveLength(1);
    const xml = strFromU8(files[objects[0]]);
    expect(new Set([...xml.matchAll(/paint_color="([^"]+)"/g)].map(match => match[1]))).toEqual(
      new Set(['4', '8', '0C']),
    );
    const points = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(match =>
      match.slice(1).map(Number),
    );
    const areas: Record<string, number> = {};
    for (const face of xml.matchAll(
      /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)" paint_color="([^"]+)"/g,
    )) {
      const [a, b, c] = face.slice(1, 4).map(index => points[Number(index)]);
      if (Math.max(a[2], b[2], c[2]) - Math.min(a[2], b[2], c[2]) > 1e-5 || a[2] < 2.5) continue;
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      areas[face[4]] = (areas[face[4]] ?? 0) + area;
    }
    expect(areas['8']).toBeGreaterThan(140);
    expect(areas['8']).toBeLessThan(155);
    expect(areas['0C']).toBeCloseTo(144, 0);
    await mkdir('../temp/painted-validation', { recursive: true });
    await writeFile(`../temp/painted-validation/terrain-${offset}.3mf`, bytes);
    await writeFile(
      `../temp/painted-validation/terrain-${offset}.json`,
      JSON.stringify({ project, areas }, null, 2),
    );
  });
}

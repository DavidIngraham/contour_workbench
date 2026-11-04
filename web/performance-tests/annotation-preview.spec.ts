import { test, expect } from '@playwright/test';
import { defaults } from '../src/types';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

test('engraved preview opens the terrain mask and restores it when removed', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = (name: string) => import(/* @vite-ignore */ '/src/' + name + '.ts');
    const { Viewer } = await load('viewer');
    const { annotationGeometry } = await load('annotations');
    const { defaults } = await load('types');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2048;
    const ctx = canvas.getContext('2d')!;
    const layout = {
      bounds: [0, 0, 1, 1],
      width: 100,
      depth: 100,
      minimum: 0,
      scale: 1,
      height_factor: 1,
      base_height: 2,
      rotated: false,
    };
    const grid = { bounds: layout.bounds, width: 2, height: 2, elevations: [0, 0, 0, 0] };
    const geometry = annotationGeometry(
      {
        id: 'test',
        name: 'test',
        kind: 'text',
        text: 'X',
        threshold: 128,
        invert: false,
        enabled: true,
        mask: [1],
        pixels_w: 1,
        pixels_h: 1,
        placement: 'terrain',
        treatment: 'engraved',
        x_mm: 50,
        y_mm: 50,
        width_mm: 10,
        height_mm: 10,
        depth_mm: 0.5,
        angle_deg: 25,
        porch_depth_mm: 16,
        porch_align: 'base',
      },
      grid,
      defaults,
      layout,
    );
    ctx.fillStyle = 'white';
    ctx.fillRect(10, 10, 10, 10);
    const state = {
      carveCanvas: canvas,
      carveTexture: {},
      layout,
      featureCarveMask: ctx.getImageData(0, 0, 2048, 2048),
    };
    Viewer.prototype.annotationCuts.call(state, geometry.preview);
    const cut = ctx.getImageData(1024, 1024, 1, 1).data[0];
    Viewer.prototype.annotationCuts.call(state, []);
    return {
      cut,
      cleared: ctx.getImageData(1024, 1024, 1, 1).data[0],
      feature: ctx.getImageData(15, 15, 1, 1).data[0],
    };
  });
  expect(result).toEqual({ cut: 255, cleared: 0, feature: 255 });
});

for (const treatment of ['raised', 'engraved', 'insert']) {
  test(`high-resolution ${treatment} lettering generates on all annotation faces`, async ({
    page,
  }, testInfo) => {
    const shaderErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && /shader|WebGLProgram|VALIDATE_STATUS/i.test(message.text()))
        shaderErrors.push(message.text());
    });
    await page.goto('/');
    await page.locator('#file-project').setInputFiles({
      name: 'label.contour.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          schema_version: 2,
          name: 'Label resolution',
          grid: {
            bounds: [0, 0, 0.001, 0.001],
            width: 5,
            height: 5,
            elevations: Array(25).fill(100),
          },
          source: { product: 'test', name: 'Test', attribution: 'Test', retrieved: 'today' },
          features: [],
          settings: { ...defaults, max_print_size_mm: [50, 50], base_height_mm: 12 },
        }),
      ),
    });
    await page.waitForFunction(
      () =>
        (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
    );
    await page.getByRole('button', { name: 'Annotations', exact: true }).click();
    await page.locator('#add-text').click();
    await page.locator('#ann-text').fill('B8O');
    await page.locator('#ann-font').selectOption('serif');
    await page.locator('#ann-treatment').selectOption(treatment);
    if (treatment === 'insert') {
      await page.locator('[data-ann-number="depth_mm"]').fill('0');
      await page.locator('[data-ann-number="insert_depth_mm"]').fill('1.5');
    }
    await expect(page.locator('#annotation-mask')).toHaveAttribute('width', '512');
    await expect(page.locator('#annotation-mask')).toHaveAttribute('height', '192');
    for (const placement of ['terrain', 'flat', 'porch', 'bottom', 'side']) {
      await page.locator('#mode-design').click();
      await page.getByRole('button', { name: 'Annotations', exact: true }).click();
      await page
        .locator('#ann-placement')
        .selectOption(placement === 'flat' ? 'terrain' : placement);
      if (placement === 'flat') await page.locator('#ann-drape').uncheck();
      if (placement === 'side') await page.locator('#ann-side').selectOption('1');
      await expect(page.locator('#annotation-warning')).toHaveText('');
      if (treatment === 'insert' || placement === 'bottom' || placement === 'side')
        await page.screenshot({ path: testInfo.outputPath(`annotation-insert-${placement}.png`) });
      if (treatment === 'insert' && placement === 'terrain') {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#mobile-settings').click();
        await page.locator('#ann-treatment').scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: testInfo.outputPath('annotation-insert-phone.png') });
        await page.locator('#mobile-close').click();
        await page.setViewportSize({ width: 1104, height: 700 });
      }
      await page.locator('#generate').click();
      await page.waitForFunction(
        () =>
          !(window as any).contourDiagnostics.busy &&
          ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
      );
      expect(
        await page.locator('#status.error').count(),
        await page.locator('#status').innerText(),
      ).toBe(0);
      expect(await page.evaluate(() => (window as any).contourDiagnostics.asset.watertight)).toBe(
        true,
      );
      if (treatment === 'insert')
        expect(
          await page.evaluate(() => (window as any).contourDiagnostics.asset.pieces),
        ).toBeGreaterThan(0);
    }
    if (treatment === 'insert') {
      await page.locator('#mode-design').click();
      await page.getByRole('button', { name: 'Print setup', exact: true }).click();
      await page.locator('#manufacturing-mode').selectOption('multicolor');
      await page.locator('#generate').click();
      await page.waitForFunction(
        () =>
          !(window as any).contourDiagnostics.busy &&
          ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
      );
      expect(
        await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight),
        await page.locator('#status').innerText(),
      ).toBe(true);
      await page.locator('#download').click();
      await page.locator('input[value="3mf"]').check();
      await page.locator('#export-slicer').selectOption('bambu');
      const download = page.waitForEvent('download');
      await page.locator('#download-confirm').click();
      const files = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
      expect(strFromU8(files['Metadata/project_settings.config'])).toContain('#DCC291');
      expect(
        Object.entries(files).some(
          ([path, data]) => path.endsWith('.model') && strFromU8(data).includes('paint_color="0C"'),
        ),
      ).toBe(true);
    }
    expect(shaderErrors).toEqual([]);
  });
}

test('face placement and optional draping survive a project round trip', async ({
  page,
}, testInfo) => {
  const shaderErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && /shader|WebGLProgram|VALIDATE_STATUS/i.test(message.text()))
      shaderErrors.push(message.text());
  });
  await page.goto('/');
  await page.locator('#file-project').setInputFiles({
    name: 'faces.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: 2,
        name: 'Face placement',
        grid: {
          bounds: [0, 0, 0.001, 0.001],
          width: 3,
          height: 3,
          elevations: Array(9).fill(100),
        },
        source: { product: 'test', name: 'Test', attribution: 'Test', retrieved: 'today' },
        features: [],
        settings: { ...defaults, max_print_size_mm: [50, 50], base_height_mm: 12 },
      }),
    ),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.locator('#add-text').click();
  await page.locator('#ann-drape').uncheck();
  await page.locator('#ann-treatment').selectOption('insert');
  await page.locator('#ann-placement').selectOption('side');
  await page.locator('#ann-side').selectOption('2');
  await page.locator('[data-ann-number="z_mm"]').fill('6');
  await page.locator('[data-ann-number="height_mm"]').fill('8');
  await page.locator('[data-ann-number="angle_deg"]').fill('5');
  await expect(page.locator('#annotation-warning')).toHaveText('');
  await page.locator('.command-menu > summary').filter({ hasText: 'File' }).click();
  const download = page.waitForEvent('download');
  await page.locator('#save-project').click();
  const path = (await (await download).path())!;
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved.annotations[0]).toMatchObject({
    placement: 'side',
    side_index: 2,
    z_mm: 6,
    drape: false,
    as_insert: true,
  });
  await page.locator('#file-project').setInputFiles(path);
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await expect(page.locator('#ann-placement')).toHaveValue('side');
  await expect(page.locator('#ann-side')).toHaveValue('2');
  await expect(page.locator('[data-ann-number="z_mm"]')).toHaveValue('6');
  await page.locator('#ann-placement').selectOption('terrain');
  await expect(page.locator('#ann-drape')).not.toBeChecked();
  await expect(page.locator('#annotation-warning')).toHaveText('');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('#mobile-settings').click();
  await page.locator('#ann-drape').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('annotation-drape-phone.png') });
  await page.locator('#mobile-close').click();
  await page.setViewportSize({ width: 1104, height: 700 });
  await page.locator('#ann-treatment').selectOption('engraved');
  await page.locator('#ann-placement').selectOption('side');
  await page.locator('#add-text').click();
  await page.locator('#ann-treatment').selectOption('engraved');
  await page.locator('#ann-placement').selectOption('bottom');
  await expect(page.locator('#annotation-warning')).toHaveText('');
  await page.screenshot({ path: testInfo.outputPath('annotation-multiple-face-masks.png') });
  await page.locator('#generate').click();
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics.busy &&
      ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
  );
  expect(
    await page.locator('#status.error').count(),
    await page.locator('#status').innerText(),
  ).toBe(0);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight)).toBe(
    true,
  );
  expect(shaderErrors).toEqual([]);
});

test('PNG inserts retain depth and color through a project round trip and print-together export', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#file-project').setInputFiles({
    name: 'artwork.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: 2,
        name: 'Artwork inserts',
        grid: { bounds: [0, 0, 0.001, 0.001], width: 3, height: 3, elevations: Array(9).fill(100) },
        source: { product: 'test', name: 'Test', attribution: 'Test', retrieved: 'today' },
        features: [],
        settings: { ...defaults, base_height_mm: 4, max_print_size_mm: [50, 50] },
      }),
    ),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillRect(4, 4, 8, 24);
    ctx.fillRect(20, 4, 8, 24);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#annotation-file').setInputFiles({
    name: 'Two bars.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.locator('#annotation-mask')).toHaveAttribute('width', '512');
  await page.locator('#ann-treatment').selectOption('insert');
  await page.locator('[data-ann-number="insert_depth_mm"]').fill('1.2');
  await page.locator('[data-ann-number="depth_mm"]').fill('0.35');
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  await expect(page.locator('[data-material-row="annotations"]')).toBeVisible();
  await page.locator('#material-annotations-color').evaluate((input: HTMLInputElement) => {
    input.value = '#cc3366';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page
    .locator('.command-menu > summary')
    .filter({ hasText: /^File$/ })
    .click();
  const projectDownload = page.waitForEvent('download');
  await page.locator('#save-project').click();
  const saved = JSON.parse(await readFile((await (await projectDownload).path())!, 'utf8'));
  expect(saved.annotations[0]).toMatchObject({
    as_insert: true,
    insert_depth_mm: 1.2,
    depth_mm: 0.35,
  });
  expect(saved.materials.find((group: any) => group.id === 'annotations').color).toBe('#cc3366');
  await page.locator('#file-project').setInputFiles({
    name: 'reopened.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await page.getByRole('button', { name: 'Annotations', exact: true }).click();
  await page.locator('[data-annotation]').click();
  await expect(page.locator('#ann-treatment')).toHaveValue('insert');
  await expect(page.locator('[data-ann-number="insert_depth_mm"]')).toHaveValue('1.2');
  await page.locator('#generate').click();
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics.busy &&
      ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
  );
  expect(
    await page.evaluate(() => (window as any).contourDiagnostics.asset?.pieces),
    await page.locator('#status').innerText(),
  ).toBe(2);
  await page.locator('#mode-design').click();
  await page.getByRole('button', { name: 'Print setup', exact: true }).click();
  await page.locator('#manufacturing-mode').selectOption('multicolor');
  await page.locator('#generate').click();
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics.busy &&
      ((window as any).contourDiagnostics.asset || document.querySelector('#status.error')),
  );
  expect(
    await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight),
    await page.locator('#status').innerText(),
  ).toBe(true);
  await page.locator('#download').click();
  await page.locator('input[value="3mf"]').check();
  await page.locator('#export-slicer').selectOption('bambu');
  const modelDownload = page.waitForEvent('download');
  await page.locator('#download-confirm').click();
  const files = unzipSync(new Uint8Array(await readFile((await (await modelDownload).path())!)));
  const models = Object.keys(files).filter(
    name => name.startsWith('3D/Objects/') && name.endsWith('.model'),
  );
  expect(models).toHaveLength(1);
  expect(strFromU8(files[models[0]])).toContain('paint_color="0C"');
  expect(strFromU8(files['Metadata/project_settings.config'])).toContain('#CC3366');
});

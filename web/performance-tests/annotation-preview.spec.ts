import { test, expect } from '@playwright/test';

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

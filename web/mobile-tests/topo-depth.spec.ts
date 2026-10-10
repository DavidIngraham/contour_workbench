import { test, expect } from '@playwright/test';

test('topo stays above the floor while panning and below terrain', async ({ page }) => {
  await page.route('**/topo-depth-fixture', route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="viewport" style="width:320px;height:320px"></div>',
    }),
  );
  await page.route('**/src/topo.ts', route =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `export async function topoSurface() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, 16, 16);
        return { canvas, corners: [[-2000,-2000],[2000,-2000],[2000,2000],[-2000,2000]], attribution: 'Fixture' };
      }`,
    }),
  );
  await page.goto('/topo-depth-fixture');
  const result = await page.evaluate(async () => {
    const viewerPath = '/src/viewer.ts';
    const threePath = '/node_modules/three/build/three.module.js';
    const { Viewer } = await import(viewerPath);
    const THREE = await import(threePath);
    const viewer = new Viewer(document.getElementById('viewport')!);
    viewer.renderer.setAnimationLoop(null);
    const ready = new Promise<void>(resolve => {
      viewer.onTopoStatus = (status: string) => {
        if (status === 'Fixture') resolve();
      };
    });
    viewer.showLoadingMap(
      { width: 220, depth: 220, bounds: [-122, 45, -121, 46], rotated: false },
      [],
    );
    await ready;
    const floor = viewer.scene.children.find((object: { receiveShadow: boolean }) =>
      Boolean(object.receiveShadow),
    );
    const target = new THREE.WebGLRenderTarget(64, 64);
    viewer.renderer.setRenderTarget(target);
    const pixel = () => {
      viewer.renderer.render(viewer.scene, viewer.camera);
      const rgba = new Uint8Array(4);
      viewer.renderer.readRenderTargetPixels(target, 32, 32, 1, 1, rgba);
      return Array.from(rgba);
    };
    const samples = [];
    for (const distance of [300, 800, 1400]) {
      for (const elevation of [0.04, 0.3, 1.2]) {
        for (const pan of [-200, 0, 200]) {
          viewer.camera.position.set(
            pan,
            -distance * Math.cos(elevation),
            distance * Math.sin(elevation),
          );
          viewer.camera.lookAt(pan, 0, 0);
          floor.visible = false;
          const expected = pixel();
          floor.visible = true;
          samples.push({ expected, actual: pixel() });
        }
      }
    }
    viewer.camera.position.set(0, 0, 500);
    viewer.camera.lookAt(0, 0, 0);
    const mapPixel = pixel();
    viewer.setTerrain(
      { positions: [0, 0, 0, 220, 0, 0, 220, 220, 0, 0, 220, 0], indices: [0, 1, 2, 0, 2, 3] },
      viewer.layout,
    );
    const terrainPixel = pixel();
    viewer.setTopo(false);
    const terrainWithoutMap = pixel();
    viewer.land.visible = false;
    const floorPixel = pixel();
    viewer.renderer.setRenderTarget(null);
    target.dispose();
    viewer.controls.dispose();
    viewer.renderer.dispose();
    return { samples, mapPixel, terrainPixel, terrainWithoutMap, floorPixel };
  });
  for (const sample of result.samples) {
    expect(sample.actual).toEqual(sample.expected);
    expect(sample.expected[0]).toBeGreaterThan(sample.expected[1] + 100);
  }
  expect(result.terrainPixel).not.toEqual(result.mapPixel);
  expect(result.terrainPixel).toEqual(result.terrainWithoutMap);
  expect(result.floorPixel).not.toEqual(result.mapPixel);
});

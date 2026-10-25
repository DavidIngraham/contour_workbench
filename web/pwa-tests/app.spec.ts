import { test, expect, type Page } from '@playwright/test';
import { defaults } from '../src/types';

async function ready(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

async function importProject(page: Page, name: string) {
  await page.locator('#file-project').setInputFiles({
    name: 'update.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema_version: 2,
        name,
        grid: {
          bounds: [0, 0, 0.001, 0.001],
          width: 5,
          height: 5,
          elevations: Array(25).fill(100),
        },
        source: {
          product: 'test',
          name: 'Local data',
          attribution: 'Test',
          retrieved: '2026-10-25',
        },
        settings: { ...defaults, max_print_size_mm: [50, 50] },
        features: [],
      }),
    ),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
}

async function stageUpdate(page: Page, request: import('@playwright/test').APIRequestContext) {
  await request.post('http://127.0.0.1:5182/__test/release?version=2');
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
  );
  await expect(page.locator('#pwa-reload')).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5182/__test/release?version=1');
});

test('icons and installable manifest resolve within the deployment path', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await ready(page);
  const manifestUrl = await page
    .locator('link[rel="manifest"]')
    .evaluate((link: HTMLLinkElement) => link.href);
  expect(manifestUrl).toBe(baseURL + 'app.webmanifest');
  const manifest = await (await page.request.get(manifestUrl)).json();
  for (const field of ['id', 'scope', 'start_url'])
    expect(new URL(manifest[field], manifestUrl).href).toBe(baseURL);
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(async src => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return `${image.width}x${image.height}`;
    }, new URL(icon.src, manifestUrl).href);
    expect(dimensions).toBe(icon.sizes);
  }
  for (const link of await page.locator('link[rel="icon"],link[rel="apple-touch-icon"]').all()) {
    const href = await link.evaluate((element: HTMLLinkElement) => element.href);
    expect(href.startsWith(baseURL!)).toBe(true);
    expect((await page.request.get(href)).ok()).toBe(true);
  }
  const ico = await (await page.request.get(baseURL + 'favicon.ico')).body();
  expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
  const cdp = await context.newCDPSession(page);
  expect((await cdp.send('Page.getAppManifest')).errors).toEqual([]);
  await expect
    .poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors)
    .toEqual([]);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        (window as any).installPrompted = true;
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Help and installation…' }).click();
  await page.locator('#install-app').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('install-app.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  expect(await page.evaluate(() => (window as any).installPrompted)).toBe(true);
  await expect(page.locator('#install-app')).toBeHidden();
});

test('offline reload opens local projects and generates and exports with cached workers', async ({
  page,
  context,
}) => {
  await ready(page);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('contour-workbench:'));
    return (await (await caches.open(names[0])).keys()).map(request => request.url);
  });
  expect(cached.some(url => url.endsWith('.wasm'))).toBe(true);
  expect(cached.some(url => url.endsWith('.cwpack'))).toBe(false);
  expect(cached.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  const project = {
    schema_version: 2,
    name: 'Offline terrain',
    grid: { bounds: [0, 0, 0.001, 0.001], width: 5, height: 5, elevations: Array(25).fill(100) },
    source: { product: 'test', name: 'Local data', attribution: 'Test', retrieved: '2026-10-23' },
    settings: { ...defaults, max_print_size_mm: [50, 50] },
    features: [],
  };
  await page.locator('#file-project').setInputFiles({
    name: 'offline.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.locator('#generate').click();
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.asset?.watertight)).toBe(
    true,
  );
  await page.locator('#download').click();
  await page.locator('input[value="stl"]').check();
  const download = page.waitForEvent('download');
  await page.locator('#download-confirm').click();
  expect((await download).suggestedFilename()).toBe('Offline terrain.zip');
  await expect(page.locator('#save-status')).toContainText('Saved');
  await page.reload();
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.getByRole('button', { name: 'Open Offline terrain', exact: true }).click();
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
});

test('updates wait for open windows and a failed release keeps the working version', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  await page.evaluate(async () => {
    await caches.open('unrelated-app');
  });
  await request.post('http://127.0.0.1:5182/__test/release?version=2');
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
  );
  await expect(page.locator('#pwa-status')).toContainText('An update is ready');
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  const second = await context.newPage();
  await second.goto(baseURL!);
  await expect(second.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await second.close();
  await page.close();
  const next = await context.newPage();
  await expect
    .poll(async () => {
      await next.goto(baseURL!);
      return next.locator('meta[name="test-release"]').getAttribute('content');
    })
    .toBe('2');
  await next.evaluate(() => navigator.serviceWorker.ready);
  expect(await next.evaluate(() => caches.has('unrelated-app'))).toBe(true);
  await expect
    .poll(async () =>
      next.evaluate(() => caches.has(`contour-workbench:${location.pathname}:test-1`)),
    )
    .toBe(false);
  await request.post('http://127.0.0.1:5182/__test/release?version=3');
  await next.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    await registration.update();
    const worker = registration.installing;
    if (worker && worker.state !== 'redundant')
      await new Promise<void>(resolve =>
        worker.addEventListener('statechange', () => {
          if (worker.state === 'redundant') resolve();
        }),
      );
  });
  await context.setOffline(true);
  await next.reload();
  await expect(next.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
  await next.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
});

test('explicit update saves pending edits and reloads every open Workbench window', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  await importProject(page, 'First project');
  const second = await context.newPage();
  await second.goto(baseURL!);
  await second.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await importProject(second, 'Second project');
  await stageUpdate(page, request);
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await expect(second.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await page.locator('#base-height').fill('2.3');
  await second.locator('#base-height').fill('3.4');
  await page.locator('#pwa-reload').click();
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
  await expect(second.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
  for (const [window, name, height] of [
    [page, 'First project', '2.3'],
    [second, 'Second project', '3.4'],
  ] as const) {
    await window.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    await window.waitForFunction(
      () =>
        (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
    );
    await expect(window.locator('#base-height')).toHaveValue(height);
    await expect(window.locator('#pwa-update-banner')).toBeHidden();
  }
});

test('another window with an unfinished operation postpones activation and can retry', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const second = await context.newPage();
  await second.goto(baseURL!);
  await second.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await importProject(second, 'Area edit');
  await second.locator('#change-area').click();
  await stageUpdate(page, request);
  await page.locator('#pwa-reload').click();
  await expect(page.locator('#pwa-update-message')).toContainText(
    'Finish or cancel the open dialog',
  );
  await expect(page.locator('#pwa-reload')).toBeEnabled();
  await expect(second.locator('#pwa-update-progress')).toBeHidden();
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await second.locator('#area-close').click();
  await page.locator('#pwa-reload').click();
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
  await expect(second.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
});

test('failed durable storage keeps the current release and project open', async ({
  page,
  request,
}) => {
  await ready(page);
  await importProject(page, 'Unsaved backup');
  await expect(page.locator('#save-status')).toHaveText('Saved locally');
  await stageUpdate(page, request);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<typeof original>
    ) {
      if (args[1] === 'readwrite')
        throw new DOMException('Test storage failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.locator('#base-height').fill('4.5');
  await page.locator('#pwa-reload').click();
  await expect(page.locator('#pwa-update-message')).toContainText('Export a project backup');
  await expect(page.locator('#pwa-reload')).toBeEnabled();
  await expect(page.locator('#pwa-update-progress')).toBeHidden();
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await expect(page.locator('#base-height')).toHaveValue('4.5');
  expect(
    await page.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    ),
  ).toBe(true);
});

test('an older or unresponsive window postpones the update without freezing the editor', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const older = await context.newPage();
  await older.route('**/unresponsive-window', route =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Older Workbench window</h1>' }),
  );
  await older.goto(new URL('unresponsive-window', baseURL!).href);
  await stageUpdate(page, request);
  await page.locator('#pwa-reload').click();
  await expect(page.locator('#pwa-update-message')).toContainText('did not respond', {
    timeout: 20000,
  });
  await expect(page.locator('#pwa-update-progress')).toBeHidden();
  await expect(page.locator('#pwa-reload')).toBeEnabled();
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await older.close();
  await page.locator('#pwa-reload').click();
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
});

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

async function stageUpdate(
  page: Page,
  request: import('@playwright/test').APIRequestContext,
  version = 2,
) {
  await request.post(`http://127.0.0.1:5182/__test/release?version=${version}`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
}

async function expectRelease(page: Page, version: number) {
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute(
    'content',
    String(version),
  );
  await page.waitForFunction(() => Boolean((window as any).contourDiagnostics));
  await expect(page.locator('#pwa-update-banner')).toBeHidden();
  await expect(page.locator('#pwa-update-progress')).toHaveCount(0);
}

async function expectController(page: Page, version: number) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string>(resolve => {
              if (!navigator.serviceWorker.controller) {
                resolve('uncontrolled');
                return;
              }
              const channel = new MessageChannel();
              const timer = setTimeout(() => {
                channel.port1.close();
                resolve('no response');
              }, 2500);
              channel.port1.onmessage = event => {
                clearTimeout(timer);
                channel.port1.close();
                resolve(event.data.version);
              };
              navigator.serviceWorker.controller.postMessage({ type: 'GET_RELEASE' }, [
                channel.port2,
              ]);
            }),
        ),
      { timeout: 15000 },
    )
    .toBe(`test-${version}`);
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

test('idle windows update quietly and unchanged assets are reused', async ({ page, request }) => {
  await ready(page);
  await page.evaluate(() => caches.open('unrelated-app'));
  const before = await (await request.get('http://127.0.0.1:5182/__test/requests')).json();
  await stageUpdate(page, request);
  await expectRelease(page, 2);
  await expectController(page, 2);
  const after = await (await request.get('http://127.0.0.1:5182/__test/requests')).json();
  for (const path of Object.keys(before).filter(path => /\.(wasm|css)$/.test(path)))
    expect(after[path], path).toBe(before[path]);
  expect(await page.evaluate(() => caches.has('unrelated-app'))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => caches.has(`contour-workbench:${location.pathname}:test-1`)))
    .toBe(false);
});

test('an open dialog postpones only its window and retries without a click', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const second = await context.newPage();
  await second.goto(baseURL!);
  await importProject(second, 'Dialog survivor');
  await second.locator('#change-area').click();
  await stageUpdate(page, request);
  await expectRelease(page, 2);
  await expectController(second, 2);
  await expect(second.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await expect(second.locator('#pwa-update-banner')).toBeHidden();
  await expect(second.locator('#area-dialog')).toBeVisible();
  await second.locator('#area-close').click();
  await expectRelease(second, 2);
  await second.waitForFunction(
    () =>
      !(window as any).contourDiagnostics?.busy && !(window as any).contourDiagnostics?.landingOpen,
  );
  await expect(second.locator('#base-height')).toHaveValue(String(defaults.base_height_mm));
});

test('pending edits and the selected panel survive an automatic per-window update', async ({
  page,
  request,
}, testInfo) => {
  await ready(page);
  await importProject(page, 'Restore this project');
  await page.locator('#base-height').fill('3.4');
  await page.locator('[data-tab="print"]').click();
  // Keep editing focused while the new worker activates.
  await page.locator('#base-height').focus();
  const view = await page.evaluate(() => ({
    camera: (window as any).contourDiagnostics.camera,
    target: (window as any).contourDiagnostics.cameraTarget,
  }));
  await stageUpdate(page, request);
  await expectController(page, 2);
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await page.locator('#base-height').blur();
  await expectRelease(page, 2);
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics?.busy && !(window as any).contourDiagnostics?.landingOpen,
  );
  await expect(page.locator('#base-height')).toHaveValue('3.4');
  await expect(page.locator('[data-tab="print"]')).toHaveClass(/active/);
  const restored = await page.evaluate(() => ({
    camera: (window as any).contourDiagnostics.camera,
    target: (window as any).contourDiagnostics.cameraTarget,
  }));
  for (let i = 0; i < 3; i++) {
    expect(restored.camera[i]).toBeCloseTo(view.camera[i], 4);
    expect(restored.target[i]).toBeCloseTo(view.target[i], 4);
  }
  await page.screenshot({ path: testInfo.outputPath('automatic-update-restored.png') });
});

test('a frozen window does not delay activation and retains obsolete lazy assets', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const second = await context.newPage();
  await second.goto(baseURL!);
  await importProject(second, 'Sleeping project');
  await second.locator('#base-height').fill('4.2');
  await second.locator('#base-height').blur();
  await expect(second.locator('#save-status')).toHaveText('Saved locally');
  // Headless tabs all report visible. Real frozen background windows are hidden.
  await second.evaluate(() =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    }),
  );
  const cdp = await context.newCDPSession(second);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await stageUpdate(page, request);
  await expectRelease(page, 2);
  const workerSession = await context.newCDPSession(page);
  await workerSession.send('ServiceWorker.enable');
  await workerSession.send('ServiceWorker.stopAllWorkers');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expectController(page, 2);
  expect(
    await page.evaluate(() => caches.has(`contour-workbench:${location.pathname}:test-1`)),
  ).toBe(true);
  // The server no longer has this module. The claimed old page still needs it.
  expect(
    await page.evaluate(
      async url => (await import(url)).release,
      new URL('assets/release-1.js', baseURL!).href,
    ),
  ).toBe(1);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await second.bringToFront();
  await second.evaluate(() => {
    delete (document as any).visibilityState;
    document.dispatchEvent(new Event('resume'));
  });
  await expectRelease(second, 2);
  await second.waitForFunction(
    () =>
      !(window as any).contourDiagnostics?.busy && !(window as any).contourDiagnostics?.landingOpen,
  );
  await expect(second.locator('#base-height')).toHaveValue('4.2');
});

test('an unknown legacy window cannot block updates or lose its old assets', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const legacy = await context.newPage();
  await legacy.route('**/legacy-window', route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Legacy Workbench</h1><p id="status"></p>',
    }),
  );
  await legacy.goto(new URL('legacy-window', baseURL!).href);
  await legacy.evaluate(async () => {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data.type === 'UPDATE_CANCELED')
        document.getElementById('status')!.textContent = event.data.reason;
    });
    const reg = (await navigator.serviceWorker.getRegistration())!;
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing!;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') installing.postMessage({ type: 'APPLY_UPDATE' });
      });
    });
  });
  // Simulate a pre-manifest release cache from the currently deployed worker.
  await page.evaluate(async () => {
    const cache = await caches.open(`contour-workbench:${location.pathname}:legacy`);
    await cache.put(
      new URL('assets/legacy-only.js', location.href),
      new Response('export const legacy = true;', {
        headers: { 'Content-Type': 'text/javascript' },
      }),
    );
  });
  await stageUpdate(page, request);
  await expectRelease(page, 2);
  await expect(legacy.locator('#status')).toContainText('Refresh this window once');
  expect(
    await page.evaluate(
      async url => (await import(url)).legacy,
      new URL('assets/legacy-only.js', baseURL!).href,
    ),
  ).toBe(true);
  await legacy.close();
});

for (const automatic of [false, true]) {
  test(`failed durable storage keeps edits and recovers with ${automatic ? 'an automatic' : 'a manual'} retry`, async ({
    page,
    request,
  }) => {
    if (automatic) await page.clock.install();
    await ready(page);
    await importProject(page, 'Unsaved backup');
    await expect(page.locator('#save-status')).toHaveText('Saved locally');
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      (window as any).restoreStorage = () => {
        IDBDatabase.prototype.transaction = original;
      };
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
    await page.locator('#base-height').blur();
    await stageUpdate(page, request);
    await expect(page.locator('#pwa-update-message')).toContainText('Export a project backup', {
      timeout: 15000,
    });
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
    await expect(page.locator('#base-height')).toHaveValue('4.5');
    await page.evaluate(() => (window as any).restoreStorage());
    if (automatic) await page.clock.fastForward(31000);
    else await page.locator('#pwa-reload').click();
    await expectRelease(page, 2);
    await page.waitForFunction(
      () =>
        !(window as any).contourDiagnostics?.busy &&
        !(window as any).contourDiagnostics?.landingOpen,
    );
    await expect(page.locator('#base-height')).toHaveValue('4.5');
  });
}

test('partial releases keep the complete offline app and reconnect retries quietly', async ({
  page,
  context,
  request,
}) => {
  await ready(page);
  await stageUpdate(page, request, 3);
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !reg?.installing;
  });
  await expectRelease(page, 1);
  await context.setOffline(true);
  await page.reload();
  await expectRelease(page, 1);
  await request.post('http://127.0.0.1:5182/__test/release?version=4');
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expectRelease(page, 4);
});

test('closing another window during an update requires no retry', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const second = await context.newPage();
  await second.goto(baseURL!);
  await stageUpdate(page, request);
  await second.close();
  await expectRelease(page, 2);
});

test('rapid releases retain the editing window and apply the latest version once idle', async ({
  page,
  request,
}) => {
  await ready(page);
  await importProject(page, 'Multiple releases');
  await page.locator('#base-height').fill('3.7');
  await stageUpdate(page, request);
  await expectController(page, 2);
  await stageUpdate(page, request, 4);
  await expectController(page, 4);
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await page.locator('#base-height').blur();
  await expectRelease(page, 4);
  await page.waitForFunction(
    () =>
      !(window as any).contourDiagnostics?.busy && !(window as any).contourDiagnostics?.landingOpen,
  );
  await expect(page.locator('#base-height')).toHaveValue('3.7');
});

test('network HTML waits for its delayed matching worker without reverting to the old app', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  const editing = await context.newPage();
  await editing.goto(baseURL!);
  await importProject(editing, 'Delayed worker');
  await editing.locator('#base-height').fill('3.7');
  await request.post('http://127.0.0.1:5182/__test/release?version=2&holdWorker=1');
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.reload', { ignoreCache: true });
    await expectRelease(page, 2);
    await expect
      .poll(() => page.evaluate(() => Boolean((window as any).contourDiagnostics?.landingOpen)))
      .toBe(true);
    await expectController(editing, 1);
    await request.post('http://127.0.0.1:5182/__test/resume-worker');
    await expectController(page, 2);
    await expectController(editing, 2);
    await expectRelease(page, 2);
    await expect(editing.locator('#base-height')).toHaveValue('3.7');
    await context.setOffline(true);
    await page.reload();
    await expectRelease(page, 2);
  } finally {
    await request.post('http://127.0.0.1:5182/__test/resume-worker');
  }
});

for (const hard of [false, true]) {
  test(`${hard ? 'hard' : 'normal'} refresh discovers the latest release without blocking other work`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    await ready(page);
    const second = await context.newPage();
    await second.goto(baseURL!);
    await importProject(second, 'Keep editing');
    await second.locator('#base-height').fill('3.7');
    await request.post('http://127.0.0.1:5182/__test/release?version=2');
    if (hard) {
      const session = await context.newCDPSession(page);
      await session.send('Page.reload', { ignoreCache: true });
    } else await page.reload();
    await expectRelease(page, 2);
    await expectController(page, 2);
    await expectController(second, 2);
    await expect(second.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
    await expect(second.locator('#base-height')).toHaveValue('3.7');
    await second.locator('#base-height').blur();
    await expectRelease(second, 2);
    await second.waitForFunction(
      () =>
        !(window as any).contourDiagnostics?.busy &&
        !(window as any).contourDiagnostics?.landingOpen,
    );
    await expect(second.locator('#base-height')).toHaveValue('3.7');
    await context.setOffline(true);
    await page.reload();
    await expectRelease(page, 2);
  });
}

test('a successful HTTP response with stale bytes cannot replace the offline release', async ({
  page,
  context,
  request,
}) => {
  await ready(page);
  await stageUpdate(page, request, 5);
  await page.waitForFunction(
    async () => !(await navigator.serviceWorker.getRegistration())?.installing,
  );
  await expectRelease(page, 1);
  await expect
    .poll(() => page.evaluate(() => caches.has(`contour-workbench:${location.pathname}:test-5`)))
    .toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expectRelease(page, 1);
});

test('incompatible project storage waits for old windows to close', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ready(page);
  await stageUpdate(page, request, 6);
  await page.waitForFunction(async () =>
    Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
  );
  await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '1');
  await expect(page.locator('#pwa-update-message')).toContainText('Close other Workbench windows');
  await page.close();
  const next = await context.newPage();
  await expect
    .poll(async () => {
      await next.goto(baseURL!);
      return next.locator('meta[name="test-release"]').getAttribute('content');
    })
    .toBe('6');
});

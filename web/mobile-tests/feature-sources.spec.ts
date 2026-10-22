import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults } from '../src/types';
import { defaultFeatureSources } from '../src/feature-sources';

const fixture = {
  schema_version: 2,
  name: 'Source test',
  grid: {
    bounds: [-0.001, -0.001, 0.011, 0.011],
    width: 5,
    height: 5,
    elevations: Array(25).fill(100),
  },
  source: { product: 'test', name: 'Test elevation', retrieved: '2026-10-22', attribution: 'Test' },
  features: [],
  settings: {
    ...defaults,
    max_print_size_mm: [150, 150],
    boundary: [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ],
  },
};
const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'ridge',
      properties: { LABEL: 'Local Ridge' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.002, 0.005],
          [0.008, 0.005],
        ],
      },
    },
  ],
};
async function openProject(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'source.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.waitForFunction(
    () => (window as any).contourDiagnostics?.triangles && !(window as any).contourDiagnostics.busy,
  );
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: /^Features/ }).tap();
}
async function addSource(page: Page) {
  await page.locator('#source-new').tap();
  await page.getByLabel('Source name', { exact: true }).fill('Local network');
  await page
    .getByLabel('GeoJSON or ArcGIS layer URL')
    .fill('https://trails.example.org/data?bbox={bbox}');
  await page.getByLabel('Feature type', { exact: true }).selectOption('trail');
  await page.getByLabel('Name field (optional)').fill('LABEL');
  await page.locator('#source-save').tap();
  await expect(page.locator('#source-message')).toContainText('Source saved');
}

test('OpenSkiMap loads ski classes, excludes inactive features, and preserves edits across content updates', async ({
  page,
}) => {
  let revision = 1;
  let inactive = false;
  await page.route('https://api.openskimap.org/features.geojson?**', async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('bbox')).toBe('0,0,0.01,0.01');
    expect(url.searchParams.get('types')).toBe('run,lift');
    const feature = (id: number, type: string, uses: string[], status = 'operating') => ({
      ...geojson.features[0],
      id: undefined,
      properties: {
        id: `${id}-v${revision}`,
        type,
        uses,
        status: inactive ? 'abandoned' : status,
        name: `Ski feature ${id}`,
        sources: [{ type: 'openstreetmap', id: `way/${id}` }],
      },
    });
    await route.fulfill({
      contentType: 'application/geo+json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          feature(1, 'run', ['downhill']),
          feature(2, 'lift', []),
          feature(3, 'run', ['hike']),
          feature(4, 'lift', [], 'abandoned'),
        ],
      }),
    });
  });
  await openProject(page);
  await page.locator('#feature-source').selectOption('openskimap');
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(2);
  const run = page.locator('[data-feature]').filter({ hasText: 'Ski feature 1' });
  await run.locator('[data-toggle]').uncheck();
  revision++;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(2);
  await expect(run.locator('[data-toggle]')).not.toBeChecked();
  inactive = true;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(0);
  await expect(page.locator('#status')).toContainText('No features from OpenSkiMap');
});

test('custom sources persist, refresh without duplicates, and preserve exported edits', async ({
  page,
}, testInfo) => {
  let broken = false;
  await page.route('https://trails.example.org/**', route =>
    route.fulfill({
      status: broken ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(geojson),
    }),
  );
  await openProject(page);
  await expect(page.locator('#feature-source option')).toHaveText(
    defaultFeatureSources.map(s => s.name),
  );
  await addSource(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  const trail = page.locator('[data-feature]').filter({ hasText: 'Local Ridge' });
  await trail.locator('[data-treatment]').selectOption('v_carve');
  await trail.locator('[data-toggle]').uncheck();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(trail.locator('[data-treatment]')).toHaveValue('v_carve');
  await expect(trail.locator('[data-toggle]')).not.toBeChecked();
  broken = true;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toHaveText('Retry source');
  await expect(page.locator('#status')).toContainText('HTTP 503');
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  broken = false;
  await page.locator('#source-edit').tap();
  await page.getByLabel('Source name', { exact: true }).fill('My local network');
  await page.screenshot({ path: testInfo.outputPath('source-library.png') });
  await page.locator('#source-save').tap();
  await page.locator('#mobile-close').tap();
  const pending = page.waitForEvent('download');
  await page.locator('#save-project').tap();
  const download = await pending;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.features[0]).toMatchObject({
    name: 'Local Ridge',
    enabled: false,
    treatment: 'v_carve',
    tags: { contour_source: { name: 'Local network' } },
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'saved.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page.waitForFunction(() => !(window as any).contourDiagnostics.busy);
  await page.locator('#mobile-settings').tap();
  await page.getByRole('button', { name: /^Features/ }).tap();
  await page.locator('#feature-source').selectOption({ label: 'My local network' });
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(trail.locator('[data-toggle]')).not.toBeChecked();
  await page.locator('#source-remove').tap();
  await expect(page.locator('#source-message')).toContainText('Source removed');
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('#feature-source option')).toHaveCount(defaultFeatureSources.length);
});

test('source cancellation and project changes suppress late downloads', async ({ page }) => {
  await page.route('https://trails.example.org/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(geojson) });
    } catch {
      /* Canceled request. */
    }
  });
  await openProject(page);
  await addSource(page);
  await page.locator('#fetch-osm').tap();
  await page.locator('#cancel-feature-source').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-feature]')).toHaveCount(0);
  await page.locator('#fetch-osm').tap();
  await page.locator('#mobile-close').tap();
  await page.locator('#show-projects').tap();
  await expect(page.locator('#landing-dialog')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).contourDiagnostics.features)).toBe(0);
});

test('HRC uses its built-in ArcGIS source and refreshes bundled county IDs', async ({ page }) => {
  let closed = false;
  await page.route('**/Recreational_Trails_Public/FeatureServer/134/query?**', async route => {
    const url = new URL(route.request().url());
    const data =
      url.searchParams.get('returnIdsOnly') === 'true'
        ? { objectIdFieldName: 'OBJECTID', objectIds: [1] }
        : {
            type: 'FeatureCollection',
            features: [
              {
                ...geojson.features[0],
                id: 1,
                properties: {
                  OBJECTID: 1,
                  Trail_Name: null,
                  Trail_Type: 'Single Track',
                  Difficulty: closed ? 'Closed Trail' : 'Easy',
                  Name: 'County trail',
                },
              },
            ],
          };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await openProject(page);
  await page.locator('#feature-source').selectOption('hrc');
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('[data-feature="county-trail:1"]')).toHaveCount(1);
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  closed = true;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(0);
});

test('national and state sources load named trails within the terrain and clear empty snapshots', async ({
  page,
}) => {
  let empty = false;
  const sources = defaultFeatureSources.filter(s =>
    ['usfs', 'nps', 'blm', 'wa-rco'].includes(s.id),
  );
  for (const source of sources) {
    await page.route(source.url + '/query?**', async route => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('geometry')).toBe('0,0,0.01,0.01');
      const idField = source.id === 'usfs' ? 'objectid' : 'OBJECTID';
      const data =
        query.get('returnIdsOnly') === 'true'
          ? { objectIdFieldName: idField, objectIds: empty ? null : [1] }
          : {
              type: 'FeatureCollection',
              features: [
                {
                  ...geojson.features[0],
                  id: 1,
                  properties: { [idField]: 1, [source.nameField]: `${source.id} named trail` },
                },
              ],
            };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
  }
  await openProject(page);
  for (const source of sources) {
    await page.locator('#feature-source').selectOption(source.id);
    await expect(page.locator('#source-description')).toHaveText(source.description!);
    await page.locator('#fetch-osm').tap();
    await expect(page.locator('#fetch-osm')).toBeEnabled();
    await expect(page.locator(`[data-feature="source:${source.id}:1"]`)).toContainText(
      `${source.id} named trail`,
    );
  }
  await expect(page.locator('[data-feature]')).toHaveCount(4);
  empty = true;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('#status')).toContainText('No features from Washington State');
  await expect(page.locator('[data-feature]')).toHaveCount(3);
});

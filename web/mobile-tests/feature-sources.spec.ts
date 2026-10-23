import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { defaults, type Feature } from '../src/types';
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
async function openProject(page: Page, features: Feature[] = []) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).contourDiagnostics?.landingOpen);
  await page.locator('#file-project').setInputFiles({
    name: 'source.contour.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...fixture, features })),
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

test('OpenStreetMap requests and imports only the selected classes', async ({ page }) => {
  let query = '';
  await page.route('**/api/interpreter', async route => {
    query = new URLSearchParams(route.request().postData() ?? '').get('data') ?? '';
    await route.fulfill({
      json: {
        elements: ['path', 'residential'].map((highway, id) => ({
          type: 'way',
          id: id + 100,
          tags: { highway, name: highway },
          geometry: [
            { lon: 0.003, lat: 0.006 },
            { lon: 0.007, lat: 0.006 },
          ],
        })),
      },
    });
  });
  await openProject(page);
  const classes = page.locator('#source-classes');
  for (const label of ['Roads', 'Waterways', 'Lakes & rivers', 'Glaciers', 'Ski runs', 'Ski lifts'])
    await classes.getByLabel(label, { exact: true }).uncheck();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  expect(query).toContain('path|footway');
  expect(query).not.toContain('residential');
  expect(query).not.toContain('waterway');
  expect(query).not.toContain('aerialway');
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('[data-feature-source="overpass"] .feature-item span')).toHaveText(
    'path',
  );
});

test('class selections persist per source and only refresh the chosen classes', async ({
  page,
}) => {
  let empty = false;
  const requests: string[] = [];
  await page.route('https://api.openskimap.org/features.geojson?**', route => {
    requests.push(new URL(route.request().url()).searchParams.get('types')!);
    return route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: empty
          ? []
          : ['run', 'lift'].map((type, id) => ({
              ...geojson.features[0],
              id,
              properties: {
                type,
                name: type,
                uses: ['downhill'],
                status: 'operating',
                sources: [{ type: 'openstreetmap', id: `way/${id}` }],
              },
            })),
      },
    });
  });
  await openProject(page);
  await page.locator('#feature-source').selectOption('openskimap');
  const classes = page.locator('#source-classes');
  await classes.getByLabel('Ski lifts', { exact: true }).uncheck();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  expect(requests).toEqual(['run']);
  await classes.getByLabel('Ski runs', { exact: true }).uncheck();
  await expect(page.locator('#fetch-osm')).toBeDisabled();
  await classes.getByLabel('Ski lifts', { exact: true }).check();
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(2);
  empty = true;
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('[data-feature] .feature-item span')).toHaveText('run');
  expect(requests).toEqual(['run', 'lift', 'lift']);
  await page.locator('#feature-source').selectOption('hrc');
  await expect(classes.getByLabel('Trails', { exact: true })).toBeChecked();
  await page.locator('#feature-source').selectOption('openskimap');
  await expect(classes.getByLabel('Ski runs', { exact: true })).not.toBeChecked();
  await openProject(page);
  await page.locator('#feature-source').selectOption('openskimap');
  await expect(classes.getByLabel('Ski runs', { exact: true })).not.toBeChecked();
  await expect(classes.getByLabel('Ski lifts', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('each class lists sources and feature names alphabetically and remains editable', async ({
  page,
}) => {
  const feature = (id: string, name: string): Feature => ({
    id,
    name,
    class: 'trail',
    enabled: true,
    tags: {},
    lines: [
      [
        [0.002, 0.005],
        [0.008, 0.005],
      ],
    ],
  });
  await openProject(page, [
    feature('osm:way:2', 'Zulu trail'),
    feature('county-trail:1', 'County trail'),
    feature('osm:way:1', 'Alpha trail'),
  ]);
  await expect(page.locator('.feature-source-heading span')).toHaveText([
    'Hood River County · recreation trails',
    'OpenStreetMap · Overpass',
  ]);
  const osm = page.locator('[data-feature-source="overpass"]');
  await expect(osm.locator('.feature-item span')).toHaveText(['Alpha trail', 'Zulu trail']);
  await osm.getByLabel('Show Alpha trail', { exact: true }).uncheck();
  await expect(osm.getByLabel('Show Alpha trail', { exact: true })).not.toBeChecked();
  await page.getByLabel('Search features').fill('Hood River');
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('.feature-item span')).toHaveText('County trail');
});

test('source controls apply to the whole class group and preserve other sources and classes', async ({
  page,
}, testInfo) => {
  const feature = (id: string, name: string, cls: Feature['class'] = 'trail'): Feature => ({
    id,
    name,
    class: cls,
    enabled: true,
    treatment: 'insert',
    tags: {},
    lines: [
      [
        [0.002, 0.005],
        [0.008, 0.005],
      ],
    ],
  });
  await openProject(page, [
    feature('osm:way:1', 'Alpha trail'),
    { ...feature('osm:way:2', 'Zulu trail'), enabled: false, treatment: 'v_carve' },
    feature('county-trail:1', 'County trail'),
    feature('osm:way:3', 'Access road', 'road'),
  ]);
  const trails = page.locator('[data-feature-source="overpass"][data-source-class="trail"]');
  const toggle = trails.locator('[data-source-toggle]');
  const treatment = trails.locator('[data-source-treatment]');
  await expect(toggle).toHaveJSProperty('indeterminate', true);
  await expect(treatment).toHaveValue('mixed');
  await toggle.check();
  await expect(trails.locator('[data-toggle]:checked')).toHaveCount(2);
  await expect(toggle).toHaveJSProperty('indeterminate', false);
  await toggle.uncheck();
  await expect(trails.locator('[data-toggle]:checked')).toHaveCount(0);
  await treatment.selectOption('v_carve');
  await expect(trails.locator('[data-toggle]:checked')).toHaveCount(0);
  await expect(trails.locator('[data-treatment]').first()).toHaveValue('v_carve');
  await expect(trails.locator('[data-treatment]').last()).toHaveValue('v_carve');
  await treatment.selectOption('insert');
  await expect(trails.locator('[data-treatment]').first()).toHaveValue('insert');
  await expect(trails.locator('[data-treatment]').last()).toHaveValue('insert');
  await trails.locator('[data-treatment]').first().selectOption('v_carve');
  await expect(treatment).toHaveValue('mixed');
  await page.getByLabel('Search features').fill('Alpha');
  await expect(trails.locator('[data-feature]')).toHaveCount(1);
  await toggle.check();
  await treatment.selectOption('v_carve');
  await page.getByLabel('Search features').fill('');
  await expect(trails.locator('[data-toggle]:checked')).toHaveCount(2);
  await expect(trails.locator('[data-treatment]').last()).toHaveValue('v_carve');
  const others = page.locator('[data-feature="county-trail:1"], [data-feature="osm:way:3"]');
  await expect(others.locator('[data-toggle]:checked')).toHaveCount(2);
  for (const select of await others.locator('[data-treatment]').all())
    await expect(select).toHaveValue('insert');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await trails.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('source-group-controls.png') });
  await page.locator('#mobile-close').tap();
  const pending = page.waitForEvent('download');
  await page.locator('#save-project').tap();
  const saved = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(saved.features.map((f: Feature) => [f.id, f.enabled, f.treatment])).toEqual([
    ['osm:way:1', true, 'v_carve'],
    ['osm:way:2', true, 'v_carve'],
    ['county-trail:1', true, 'insert'],
    ['osm:way:3', true, 'insert'],
  ]);
});

test('loaded sources can be removed across classes, saved, and loaded again', async ({
  page,
}, testInfo) => {
  const feature = (id: string, name: string, cls: Feature['class'] = 'trail'): Feature => ({
    id,
    name,
    class: cls,
    enabled: true,
    treatment: 'insert',
    tags: {},
    lines: [
      [
        [0.002, 0.005],
        [0.008, 0.005],
      ],
    ],
  });
  await openProject(page, [
    feature('osm:way:1', 'Alpha trail'),
    feature('osm:way:2', 'Other trail'),
    feature('osm:way:3', 'Access road', 'road'),
    feature('county-trail:1', 'County trail'),
  ]);
  const remove = page.getByRole('button', {
    name: 'Remove OpenStreetMap · Overpass from model',
    exact: true,
  });
  await page.locator('#loaded-sources').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('loaded-sources.png') });
  page.once('dialog', dialog => dialog.dismiss());
  await remove.tap();
  await expect(page.locator('[data-feature]')).toHaveCount(4);
  await page.locator('[data-feature="osm:way:1"] .feature-item > span').tap();
  await page.getByLabel('Search features').fill('Alpha');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('all 3 features');
    await dialog.accept();
  });
  await remove.tap();
  await expect(remove).toHaveCount(0);
  await expect(page.locator('[data-feature]')).toHaveCount(0);
  await page.getByLabel('Search features').fill('');
  await expect(page.locator('[data-feature]')).toHaveCount(1);
  await expect(page.locator('[data-feature="county-trail:1"] [data-toggle]')).toBeChecked();
  await page.locator('#mobile-close').tap();
  const pending = page.waitForEvent('download');
  await page.locator('#save-project').tap();
  const saved = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(saved.features.map((f: Feature) => f.id)).toEqual(['county-trail:1']);
  await openProject(page, saved.features);
  await expect(remove).toHaveCount(0);
  await page.route('**/api/interpreter', route =>
    route.fulfill({
      json: {
        elements: [
          {
            type: 'way',
            id: 1,
            tags: { highway: 'path', name: 'Reloaded trail' },
            geometry: [
              { lon: 0.003, lat: 0.006 },
              { lon: 0.007, lat: 0.006 },
            ],
          },
        ],
      },
    }),
  );
  await page.locator('#fetch-osm').tap();
  await expect(page.locator('#fetch-osm')).toBeEnabled();
  await expect(remove).toBeVisible();
  await expect(page.locator('[data-feature]')).toHaveCount(2);
});

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

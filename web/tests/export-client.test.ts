import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportClient } from '../src/export-client';
import { buildExport } from '../src/export-formats';
import type { ExportRequest } from '../src/export-contract';
import { strFromU8, unzipSync } from 'fflate';
import { defaults, type Asset, type Project } from '../src/types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  terminated = false;
  message?: unknown;
  transfers: Transferable[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown, transfers: Transferable[]) {
    this.message = message;
    this.transfers = transfers;
  }
  terminate() {
    this.terminated = true;
  }
}
const project: Project = {
  schema_version: 2,
  name: 'Test',
  grid: { bounds: [0, 0, 1, 1], width: 2, height: 2, elevations: [0, 0, 0, 0] },
  source: { product: 'test', name: 'Test', retrieved: 'today', attribution: 'Test' },
  features: [],
  settings: defaults,
};
const asset: Asset = {
  terrain: { positions: [0, 0, 0], indices: [0, 0, 0] },
  inserts: [],
  validation: { watertight: true, triangles: 1, pieces: 0, removed_terrain_islands: 0 },
  revision: 1,
};

describe('disposable export worker', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('encodes source credits through the compact worker payload without copying features', async () => {
    const sourceProject: Project = {
      ...project,
      features: [
        {
          id: 'ski:1',
          name: 'Run',
          class: 'ski_run',
          enabled: true,
          lines: [],
          tags: { contour_source: { attribution: 'OpenSkiMap credits' } },
        },
      ],
    };
    const pending = new ExportClient().run('stl', asset, sourceProject);
    const worker = FakeWorker.instances[0];
    const request = worker.message as ExportRequest;
    expect(request.project).not.toHaveProperty('features');
    expect(request.project.source.attribution).toBe('Test\nOpenSkiMap credits');
    expect(sourceProject.source.attribution).toBe('Test');
    const result = buildExport(
      request.format,
      request.asset,
      request.project as Project,
      request.projectFile,
    );
    const files = unzipSync(result.bytes);
    expect(strFromU8(files['attribution.txt']).split('OpenSkiMap credits')).toHaveLength(2);
    expect(JSON.parse(strFromU8(files['project.contour.json'])).features).toHaveLength(1);
    worker.onmessage?.({ data: { result } } as MessageEvent);
    await pending;
    expect(worker.terminated).toBe(true);
  });

  it('transfers compact copies and terminates after success', async () => {
    const client = new ExportClient();
    const pending = client.run('bambu', asset, project, undefined, undefined, {
      bambuPrinter: 'a1-mini',
    });
    const worker = FakeWorker.instances[0];
    expect(worker.message).toMatchObject({ options: { bambuPrinter: 'a1-mini' } });
    expect(worker.transfers).toHaveLength(3);
    expect(asset.terrain.positions).toEqual([0, 0, 0]);
    worker.onmessage?.({
      data: { result: { bytes: new Uint8Array([1]), filename: 'test.3mf', mime: 'model/3mf' } },
    } as MessageEvent);
    await expect(pending).resolves.toMatchObject({ filename: 'test.3mf' });
    expect(worker.terminated).toBe(true);
  });

  it('terminates immediately and rejects when canceled', async () => {
    const client = new ExportClient();
    const controller = new AbortController();
    const pending = client.run('portable', asset, project, undefined, controller.signal);
    const worker = FakeWorker.instances[0];
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('copies painted face data without transferring the review asset', async () => {
    const client = new ExportClient();
    const faceMaterials = new Uint8Array([2]);
    const pending = client.run('bambu', { ...asset, faceMaterials }, project);
    const worker = FakeWorker.instances[0];
    expect(worker.transfers).toHaveLength(4);
    expect(worker.transfers).not.toContain(faceMaterials.buffer);
    expect(faceMaterials[0]).toBe(2);
    worker.onmessage?.({
      data: { result: { bytes: new Uint8Array([1]), filename: 'test.3mf', mime: 'model/3mf' } },
    } as MessageEvent);
    await pending;
  });
});

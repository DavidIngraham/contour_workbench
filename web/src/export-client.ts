/** Starts one worker per final download and always releases it after completion. */
import type { EngineProgress } from './engine-contract';
import type { ExportFormat, ExportResult } from './export-formats';
import type { ExportProject, ExportRequest, ExportResponse } from './export-contract';
import type { Asset, Mesh, Project } from './types';

const canceled = () => new DOMException('Export canceled', 'AbortError');

function compactMesh(mesh: Mesh, transfers: Transferable[]): Mesh {
  const positions = Float32Array.from(mesh.positions);
  const indices = Uint32Array.from(mesh.indices);
  transfers.push(positions.buffer, indices.buffer);
  return { positions, indices };
}

function compactAsset(asset: Asset, transfers: Transferable[]): Asset {
  return {
    ...asset,
    terrain: compactMesh(asset.terrain, transfers),
    inserts: asset.inserts.map(piece => ({
      ...piece,
      mesh: compactMesh(piece.mesh, transfers),
    })),
  };
}

export class ExportClient {
  private worker?: Worker;

  /** Encode one download from compact transferable copies and terminate on every outcome. */
  run(
    format: ExportFormat,
    asset: Asset,
    project: Project,
    progress?: (progress: EngineProgress) => void,
    signal?: AbortSignal,
  ): Promise<ExportResult> {
    if (this.worker) return Promise.reject(new Error('An export is already running.'));
    if (signal?.aborted) return Promise.reject(canceled());
    progress?.({
      message: 'Preparing compact export geometry...',
      phase: 'prepare',
      completed: 0,
      total: 2,
    });
    const worker = new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const transfers: Transferable[] = [];
    const projectFile = new TextEncoder().encode(JSON.stringify(project));
    transfers.push(projectFile.buffer);
    const compactProject: ExportProject = {
      name: project.name,
      source: project.source,
      settings: project.settings,
      materials: project.materials,
    };
    const request: ExportRequest = {
      format,
      asset: compactAsset(asset, transfers),
      project: compactProject,
      projectFile,
    };
    return new Promise((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        if (this.worker === worker) this.worker = undefined;
      };
      const abort = () => {
        finish();
        reject(canceled());
      };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = event => {
        finish();
        reject(new Error(event.message));
      };
      worker.onmessage = (event: MessageEvent<ExportResponse>) => {
        const message = event.data;
        if ('progress' in message) {
          progress?.(message.progress);
          return;
        }
        finish();
        if ('error' in message) reject(new Error(message.error));
        else resolve(message.result);
      };
      worker.postMessage(request, transfers);
    });
  }

  cancel() {
    this.worker?.terminate();
    this.worker = undefined;
  }
}

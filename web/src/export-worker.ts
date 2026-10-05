/** Disposable final-export worker. It owns transferred geometry until it exits. */
/// <reference lib="webworker" />
import { buildExport } from './export-formats';
import type { ExportRequest, ExportResponse } from './export-contract';
import type { Project } from './types';

self.onmessage = (event: MessageEvent<ExportRequest>) => {
  const request = event.data;
  const progress: ExportResponse = {
    progress: {
      message:
        request.format === 'bambu'
          ? 'Creating your Bambu Studio project…'
          : request.format === 'prusa'
            ? 'Creating your PrusaSlicer project…'
            : request.format.startsWith('shapeways')
              ? 'Creating your Shapeways files…'
              : 'Creating your model files…',
      completed: 1,
      total: 2,
    },
  };
  self.postMessage(progress);
  try {
    const result = buildExport(
      request.format,
      request.asset,
      request.project as Project,
      request.projectFile,
    );
    const response: ExportResponse = { result };
    self.postMessage(response, { transfer: [result.bytes.buffer] });
  } catch (error) {
    const response: ExportResponse = {
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  } finally {
    self.close();
  }
};

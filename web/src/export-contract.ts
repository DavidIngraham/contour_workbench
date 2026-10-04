/** Messages for one disposable final-export worker. */
import type { ExportFormat, ExportResult } from './export-formats';
import type { Asset, Project } from './types';

export type ExportProject = Pick<Project, 'name' | 'source' | 'settings' | 'materials'>;
export interface ExportRequest {
  format: ExportFormat;
  asset: Asset;
  project: ExportProject;
  projectFile: Uint8Array;
}
export type ExportResponse =
  | { progress: { message: string; completed?: number; total?: number } }
  | { result: ExportResult }
  | { error: string };

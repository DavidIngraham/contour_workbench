/** Typed messages exchanged between the UI and the geometry worker. */
import type { Annotation } from './annotations';
import type { ThreeMfKind } from './three-mf';
import type { Asset, Bounds, Feature, Overlay, Project, Settings, Terrain, Grid } from './types';

/** Progress emitted by a long-running worker operation. */
export interface EngineProgress {
  message: string;
  phase?: string;
  completed?: number;
  total?: number;
}

/** Request and result types for every geometry-worker operation. */
export interface EngineOperationMap {
  hydrate: { payload: { project: Project; terrain: Terrain }; result: true };
  classify: { payload: unknown; result: Feature[] };
  urls: { payload: { bounds: Bounds; ninety: boolean }; result: string[] };
  query: { payload: { bounds: Bounds; winter: boolean }; result: string };
  terrain: {
    payload: { grid: Grid; settings: Settings; features: Feature[] };
    result: Terrain & { terrainBuilds: number };
  };
  overlays: { payload: { settings: Settings; features: Feature[] }; result: Overlay[] };
  generate: {
    payload: {
      settings: Settings;
      features: Feature[];
      annotations: Annotation[];
      revision: number;
    };
    result: Asset;
  };
  'preset-pack': { payload: { project: Project }; result: Uint8Array };
  calibration: { payload: { settings: Settings }; result: Uint8Array };
  'export-3mf': {
    payload: { asset: Asset; project: Project; kind: ThreeMfKind };
    result: Uint8Array;
  };
  export: { payload: { asset: Asset; project: Project }; result: Uint8Array };
}

/** Valid operation name understood by the geometry worker. */
export type EngineOperation = keyof EngineOperationMap;

/** Request union whose payload is narrowed by its operation name. */
export type EngineRequest = {
  [K in EngineOperation]: {
    id: number;
    type: K;
    payload: EngineOperationMap[K]['payload'];
  };
}[EngineOperation];

/** Cancellation message for one in-flight request. */
export interface EngineCancelRequest {
  cancel: number;
}

/** Successful, failed, or progress response from the worker. */
export type EngineResponse =
  | { id: number; progress: EngineProgress }
  | { id: number; result: unknown }
  | { id: number; error: string };

/** Type guard for request messages. */
export function isEngineRequest(value: unknown): value is EngineRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EngineRequest>;
  return (
    Number.isInteger(candidate.id) &&
    typeof candidate.type === 'string' &&
    candidate.type in operationNames
  );
}

/** Type guard for cancellation messages. */
export function isEngineCancelRequest(value: unknown): value is EngineCancelRequest {
  return Boolean(
    value && typeof value === 'object' && Number.isInteger((value as EngineCancelRequest).cancel),
  );
}

const operationNames: Record<EngineOperation, true> = {
  hydrate: true,
  classify: true,
  urls: true,
  query: true,
  terrain: true,
  overlays: true,
  generate: true,
  'preset-pack': true,
  calibration: true,
  'export-3mf': true,
  export: true,
};

/** Durable local project sessions stored independently from expendable response caches. */
import type { Bounds, Project } from './types';

const databaseName = 'contour-workbench-projects';
const databaseVersion = 1;
const metadataStore = 'metadata';
const stateStore = 'state';
const terrainStore = 'terrain';
const thumbnailStore = 'thumbnails';

type EditableProject = Omit<Project, 'grid' | 'source'>;

interface StoredProjectState {
  id: string;
  project: EditableProject;
}

interface StoredTerrain {
  id: string;
  grid: Omit<Project['grid'], 'elevations'> & { elevations: Float64Array };
  source: Project['source'];
}

/** Lightweight project information used to render the landing page without loading terrain. */
export interface LocalProjectSummary {
  id: string;
  name: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_opened_at_ms: number;
  source_name: string;
  bounds: Bounds;
  feature_count: number;
  origin_preset_id?: string;
}

/** Identity retained by the autosave coordinator for one local project. */
export interface LocalProjectIdentity {
  id: string;
  created_at_ms: number;
  origin_preset_id?: string;
}

interface SaveOptions extends LocalProjectIdentity {
  write_terrain: boolean;
}

const memoryMetadata = new Map<string, LocalProjectSummary>();
const memoryState = new Map<string, StoredProjectState>();
const memoryTerrain = new Map<string, StoredTerrain>();
const memoryThumbnails = new Map<string, Blob>();
let database: Promise<IDBDatabase | undefined> | undefined;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function projectBounds(project: Project): Bounds {
  const points = project.settings.boundary;
  if (!points.length) return [...project.grid.bounds];
  return [
    Math.min(...points.map(point => point[0])),
    Math.min(...points.map(point => point[1])),
    Math.max(...points.map(point => point[0])),
    Math.max(...points.map(point => point[1])),
  ];
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  if (database) return database;
  database = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined);
      return;
    }
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      for (const name of [metadataStore, stateStore, terrainStore, thumbnailStore])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
  return database;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage request failed.'));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error('The local project could not be saved.'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('The local project save was interrupted.'));
  });
}

/** Create a collision-resistant browser-local project identifier. */
export function newLocalProjectIdentity(originPresetId?: string): LocalProjectIdentity {
  const id =
    globalThis.crypto?.randomUUID?.() ||
    `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { id, created_at_ms: Date.now(), origin_preset_id: originPresetId };
}

/** Save editable state and optionally replace the large immutable terrain record. */
export async function saveLocalProject(project: Project, options: SaveOptions): Promise<boolean> {
  const now = Date.now(),
    metadata: LocalProjectSummary = {
      id: options.id,
      name: project.name,
      created_at_ms: options.created_at_ms,
      updated_at_ms: now,
      last_opened_at_ms: now,
      source_name: project.source.name,
      bounds: projectBounds(project),
      feature_count: project.features.length,
      origin_preset_id: options.origin_preset_id,
    },
    { grid, source, ...editable } = project,
    state: StoredProjectState = { id: options.id, project: clone(editable) },
    terrain: StoredTerrain = {
      id: options.id,
      grid: { ...grid, elevations: Float64Array.from(grid.elevations) },
      source: clone(source),
    };
  memoryMetadata.set(options.id, clone(metadata));
  memoryState.set(options.id, clone(state));
  if (options.write_terrain || !memoryTerrain.has(options.id))
    memoryTerrain.set(options.id, clone(terrain));

  const db = await openDatabase();
  if (!db) return false;
  const stores = [metadataStore, stateStore, ...(options.write_terrain ? [terrainStore] : [])],
    transaction = db.transaction(stores, 'readwrite');
  transaction.objectStore(metadataStore).put(metadata);
  transaction.objectStore(stateStore).put(state);
  if (options.write_terrain) transaction.objectStore(terrainStore).put(terrain);
  await transactionResult(transaction);
  return true;
}

/** List recent projects without loading their elevation grids. */
export async function listLocalProjects(): Promise<LocalProjectSummary[]> {
  const db = await openDatabase();
  const values = db
    ? await requestResult<LocalProjectSummary[]>(
        db.transaction(metadataStore, 'readonly').objectStore(metadataStore).getAll(),
      )
    : [...memoryMetadata.values()].map(clone);
  return values.sort((a, b) => b.updated_at_ms - a.updated_at_ms);
}

/** Load a complete editable project and update its recent-project ordering. */
export async function loadLocalProject(
  id: string,
): Promise<{ project: Project; summary: LocalProjectSummary } | undefined> {
  const db = await openDatabase();
  let state: StoredProjectState | undefined,
    terrain: StoredTerrain | undefined,
    summary: LocalProjectSummary | undefined;
  if (db) {
    const transaction = db.transaction([metadataStore, stateStore, terrainStore], 'readonly');
    [summary, state, terrain] = await Promise.all([
      requestResult<LocalProjectSummary | undefined>(
        transaction.objectStore(metadataStore).get(id),
      ),
      requestResult<StoredProjectState | undefined>(transaction.objectStore(stateStore).get(id)),
      requestResult<StoredTerrain | undefined>(transaction.objectStore(terrainStore).get(id)),
    ]);
  } else {
    summary = memoryMetadata.get(id);
    state = memoryState.get(id);
    terrain = memoryTerrain.get(id);
  }
  if (!summary || !state || !terrain) return undefined;
  const opened = { ...summary, last_opened_at_ms: Date.now() };
  memoryMetadata.set(id, clone(opened));
  if (db) {
    const transaction = db.transaction(metadataStore, 'readwrite');
    transaction.objectStore(metadataStore).put(opened);
    await transactionResult(transaction);
  }
  return {
    summary: clone(opened),
    project: {
      ...clone(state.project),
      grid: {
        ...clone(terrain.grid),
        elevations: Array.from(terrain.grid.elevations),
      },
      source: clone(terrain.source),
    },
  };
}

/** Replace a project's name without loading its terrain into the landing page. */
export async function renameLocalProject(id: string, name: string): Promise<void> {
  const loaded = await loadLocalProject(id);
  if (!loaded) throw new Error('This local project no longer exists.');
  loaded.project.name = name;
  await saveLocalProject(loaded.project, {
    id,
    created_at_ms: loaded.summary.created_at_ms,
    origin_preset_id: loaded.summary.origin_preset_id,
    write_terrain: false,
  });
}

/** Create an independent editable copy of an existing local project. */
export async function duplicateLocalProject(id: string): Promise<string> {
  const loaded = await loadLocalProject(id);
  if (!loaded) throw new Error('This local project no longer exists.');
  const identity = newLocalProjectIdentity(loaded.summary.origin_preset_id);
  loaded.project.name = loaded.project.name + ' copy';
  await saveLocalProject(loaded.project, { ...identity, write_terrain: true });
  const thumbnail = await readProjectThumbnail(id);
  if (thumbnail) await writeProjectThumbnail(identity.id, thumbnail);
  return identity.id;
}

/** Delete a project, its terrain, and its optional thumbnail in one transaction. */
export async function deleteLocalProject(id: string): Promise<void> {
  memoryMetadata.delete(id);
  memoryState.delete(id);
  memoryTerrain.delete(id);
  memoryThumbnails.delete(id);
  const db = await openDatabase();
  if (!db) return;
  const transaction = db.transaction(
    [metadataStore, stateStore, terrainStore, thumbnailStore],
    'readwrite',
  );
  for (const store of [metadataStore, stateStore, terrainStore, thumbnailStore])
    transaction.objectStore(store).delete(id);
  await transactionResult(transaction);
}

/** Store a replaceable landing-page thumbnail without rewriting project state. */
export async function writeProjectThumbnail(id: string, thumbnail: Blob): Promise<void> {
  memoryThumbnails.set(id, thumbnail);
  const db = await openDatabase();
  if (!db) return;
  const transaction = db.transaction(thumbnailStore, 'readwrite');
  transaction.objectStore(thumbnailStore).put({ id, thumbnail });
  await transactionResult(transaction);
}

/** Read a project's landing-page thumbnail. */
export async function readProjectThumbnail(id: string): Promise<Blob | undefined> {
  const db = await openDatabase();
  if (!db) return memoryThumbnails.get(id);
  const record = await requestResult<{ id: string; thumbnail: Blob } | undefined>(
    db.transaction(thumbnailStore, 'readonly').objectStore(thumbnailStore).get(id),
  );
  return record?.thumbnail;
}

/** Ask the browser to protect user projects from routine storage eviction when supported. */
export async function requestPersistentProjectStorage(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return undefined;
  }
}

/** Clear process-local fallback state for deterministic unit tests. */
export function clearLocalProjectMemory() {
  memoryMetadata.clear();
  memoryState.clear();
  memoryTerrain.clear();
  memoryThumbnails.clear();
}

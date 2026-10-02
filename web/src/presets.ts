/** Static preset catalog and prebuilt mesh-pack loading. */
import { strFromU8, unzipSync } from 'fflate';
import type { Mesh, Overlay, Project, Terrain } from './types';

/** One landing-card entry in the static preset catalog. */
export interface PresetEntry {
  id: string;
  name: string;
  location: string;
  description: string;
  image: string;
  bundle: string;
  badges: string[];
}
/** Versioned landing catalog. */
export interface PresetCatalog {
  version: number;
  models: PresetEntry[];
}
/** Editable project and its prebuilt terrain and overlay meshes. */
export interface PresetBundle {
  project: Project;
  terrain: Terrain;
  overlays: Overlay[];
}
interface PackedTerrain extends Omit<Terrain, 'mesh'> {
  mesh: string;
}
interface PackedOverlay extends Omit<Overlay, 'mesh'> {
  mesh: string;
}
interface PackedManifest {
  version: number;
  project: Project;
  terrain: PackedTerrain;
  overlays: PackedOverlay[];
}

/** Resolve a preset asset below the configured Vite base path. */
export function presetUrl(path: string) {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '');
}
/** Load and validate the static landing catalog. */
/** Download and hydrate a compressed preset pack. */
export async function loadPresetCatalog(): Promise<PresetCatalog> {
  const response = await fetch(presetUrl('examples/catalog.json'));
  if (!response.ok) throw new Error('The model catalog could not be loaded.');
  const catalog = (await response.json()) as PresetCatalog;
  if (catalog.version !== 1 || !Array.isArray(catalog.models))
    throw new Error('The model catalog is not supported.');
  return catalog;
}
/** Decode the compact mesh file used inside preset packs. */
export function decodeMesh(bytes: Uint8Array): Mesh {
  if (bytes.byteLength < 8) throw new Error('Preset mesh is incomplete.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positionsLength = view.getUint32(0, true),
    indicesLength = view.getUint32(4, true);
  const positionsBytes = positionsLength * 4,
    indicesBytes = indicesLength * 4;
  if (8 + positionsBytes + indicesBytes !== bytes.byteLength)
    throw new Error('Preset mesh has an invalid length.');
  const positions = new Float32Array(bytes.slice(8, 8 + positionsBytes).buffer);
  const indices = new Uint32Array(bytes.slice(8 + positionsBytes).buffer);
  return { positions, indices };
}
/** Strip a generated part suffix from an overlay identifier. */
export function overlayFeatureId(id: string) {
  const split = id.lastIndexOf('#');
  return split < 0 ? id : id.slice(0, split);
}
/** Ensure every prebuilt overlay still maps to a project feature. */
export function validatePresetLinks(project: Project, overlays: Overlay[]) {
  const features = new Set(project.features.map(feature => feature.id));
  const orphan = overlays.find(overlay => !features.has(overlayFeatureId(overlay.id)));
  if (orphan) throw new Error('Preset overlay ' + orphan.id + ' references an unknown feature.');
}
export async function loadPreset(entry: PresetEntry): Promise<PresetBundle> {
  const response = await fetch(presetUrl(entry.bundle));
  if (!response.ok) throw new Error(entry.name + ' could not be loaded.');
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifestFile = files['manifest.json'];
  if (!manifestFile) throw new Error(entry.name + ' is missing its manifest.');
  const manifest = JSON.parse(strFromU8(manifestFile)) as PackedManifest;
  if (manifest.version !== 1) throw new Error(entry.name + ' uses an unsupported bundle version.');
  const mesh = (name: string) => {
    const file = files[name];
    if (!file) throw new Error(entry.name + ' is missing ' + name + '.');
    return decodeMesh(file);
  };
  const bundle = {
    project: manifest.project,
    terrain: { ...manifest.terrain, mesh: mesh(manifest.terrain.mesh) },
    overlays: manifest.overlays.map(item => ({ ...item, mesh: mesh(item.mesh) })),
  } as PresetBundle;
  validatePresetLinks(bundle.project, bundle.overlays);
  return bundle;
}

/** Shared serialized project and mesh contracts. Geographic coordinates use longitude/latitude; model geometry uses millimeters. */
/** Geographic bounds ordered as west, south, east, north. */
export type Bounds = [number, number, number, number];
/** Row-major elevation grid in geographic coordinates with elevations in meters. */
export interface Grid {
  bounds: Bounds;
  width: number;
  height: number;
  elevations: number[];
}
/** Manufacturing strategy for removable inserts or aligned multicolor parts. */
export type ManufacturingMode = 'separate' | 'multicolor';
/** User-controlled geometry and print settings; unit suffixes identify physical units. */
export interface Settings {
  manufacturing_mode: ManufacturingMode;
  insert_relative_height_mm: number;
  max_print_size_mm: [number, number];
  height_factor: number;
  base_height_mm: number;
  path_width_mm: number;
  path_clearance_mm: number;
  feature_edge_clearance_mm: number;
  nozzle_diameter_mm: number;
  minimum_terrain_island_width_mm: number | null;
  insert_fit_clearance_per_side_mm: number;
  insert_elephant_foot_relief_mm: number;
  insert_elephant_foot_height_mm: number;
  insert_draft_angle_deg: number;
  insert_depth_mm: number;
  zone_insert_depth_mm: number;
  zone_floor_mm: number;
  ski_run_width_m: number;
  carve_depth_mm: number;
  insert_gap_mm: number;
  insert_segment_size_mm: number | null;
  terrain_max_error_mm: number;
  boundary: [number, number][];
}
/** Defaults used for new projects and backward-compatible deserialization. */
export const defaults: Settings = {
  manufacturing_mode: 'separate',
  insert_relative_height_mm: 0.35,
  max_print_size_mm: [248, 198],
  height_factor: 1,
  base_height_mm: 1,
  path_width_mm: 0.9,
  path_clearance_mm: 0.1,
  feature_edge_clearance_mm: 1,
  nozzle_diameter_mm: 0.4,
  minimum_terrain_island_width_mm: null,
  insert_fit_clearance_per_side_mm: 0.15,
  insert_elephant_foot_relief_mm: 0.18,
  insert_elephant_foot_height_mm: 0.4,
  insert_draft_angle_deg: 1.5,
  insert_depth_mm: 2,
  zone_insert_depth_mm: 0.8,
  zone_floor_mm: 0.8,
  ski_run_width_m: 30,
  carve_depth_mm: 0.4,
  insert_gap_mm: 0.5,
  insert_segment_size_mm: null,
  terrain_max_error_mm: 0,
  boundary: [],
};
/** Temporary three-mode fields accepted only while importing older projects. */
type LegacyInsertSurfaceSettings = {
  insert_surface_mode?: 'proud' | 'flush' | 'inset';
  insert_proud_height_mm?: number;
  insert_inset_depth_mm?: number;
};
/** Merge additive fields and migrate older insert placement controls to one signed height. */
export function normalizeSettings(
  settings?: Partial<Settings> & LegacyInsertSurfaceSettings,
): Settings {
  const {
    insert_surface_mode: legacyMode,
    insert_proud_height_mm: legacyProud,
    insert_inset_depth_mm: legacyInset,
    ...canonical
  } = settings ?? {};
  let relativeHeight = canonical.insert_relative_height_mm;
  if (typeof relativeHeight !== 'number' || !Number.isFinite(relativeHeight)) {
    if (legacyMode === 'flush') relativeHeight = 0;
    else if (legacyMode === 'inset')
      relativeHeight =
        typeof legacyInset === 'number' && Number.isFinite(legacyInset) ? -legacyInset : -0.3;
    else
      relativeHeight =
        typeof legacyProud === 'number' && Number.isFinite(legacyProud) ? legacyProud : 0.35;
  }
  return { ...defaults, ...canonical, insert_relative_height_mm: relativeHeight };
}

/** Effective geometry operation selected for a feature. */
export type Treatment = 'insert' | 'hide' | 'v_carve';
/** Feature classes supported by classification, preview, and generation. */
export const featureClasses = [
  'trail',
  'road',
  'stream',
  'water',
  'glacier',
  'ski_run',
  'ski_lift',
] as const;
export type FeatureClass = (typeof featureClasses)[number];
/** Polygon-zone surface behavior. */
export type ZoneSurface = 'terrain' | 'level';
/** Polygon-zone ring data, including preserved holes. */
export interface AreaPolygon {
  outer: [number, number][];
  holes: [number, number][][];
}
/** Normalized OSM, GeoJSON, or GPX feature stored in a project. */
export interface Feature {
  treatment?: Treatment;
  id: string;
  name: string;
  class: FeatureClass;
  lines: [number, number][][];
  polygons?: AreaPolygon[];
  enabled: boolean;
  tags: Record<string, unknown>;
  surface?: ZoneSurface;
  width_m?: number;
  insert_depth_mm?: number;
}
/** Indexed triangle mesh in printer-space millimeters. */
export interface Mesh {
  positions: number[] | Float32Array;
  indices: number[] | Uint32Array;
}
/** Geographic-to-printer coordinate transform produced by Rust. */
export interface Layout {
  bounds: Bounds;
  width: number;
  depth: number;
  scale: number;
  rotated: boolean;
  minimum: number;
  height_factor: number;
  base_height: number;
}
/** Generated terrain mesh and source-resolution statistics. */
export interface Terrain {
  mesh: Mesh;
  layout: Layout;
  source_samples: number;
  retained_samples: number;
}
/** Lightweight preview mesh linked to a feature identifier. */
export interface Overlay {
  treatment: Treatment;
  id: string;
  class: Feature['class'];
  surface_offset_mm?: number;
  mesh: Mesh;
}
/** Printable insert mesh with its assembly origin and fit metadata. */
export interface Piece {
  id: string;
  class: string;
  mesh: Mesh;
  origin: [number, number, number];
  insert_depth_mm: number;
  surface_offset_mm?: number;
  conformal?: boolean;
  taper_relief_mm?: number;
  taper_height_mm?: number;
  draft_angle_deg?: number;
}
/** Validated printable terrain and insert result. */
export interface Asset {
  terrain: Mesh;
  /** One surfaceMaterials index per exterior triangle, for a single painted solid. */
  faceMaterials?: Uint8Array;
  inserts: Piece[];
  validation: {
    watertight: boolean;
    triangles: number;
    pieces: number;
    removed_terrain_islands: number;
    terrain_max_error_mm?: number;
    insert_relative_height_mm?: number;
  };
  revision: number;
}
/** Elevation provenance saved with a project. */
export interface Source {
  product: string;
  name: string;
  retrieved: string;
  attribution: string;
  urls?: string[];
  bundled?: boolean;
}
/* Printable material group shared by slicer and service exports. */
export interface MaterialGroup {
  id: 'terrain' | 'features' | FeatureClass;
  name: string;
  color: string;
  extruder: number;
}
/** Default terrain and per-feature-class assignments. */
export const defaultMaterialGroups: MaterialGroup[] = [
  { id: 'terrain', name: 'Terrain', color: '#8baa73', extruder: 1 },
  { id: 'trail', name: 'Trails', color: '#e78a43', extruder: 2 },
  { id: 'road', name: 'Roads', color: '#c2b17a', extruder: 2 },
  { id: 'stream', name: 'Streams', color: '#609ca7', extruder: 2 },
  { id: 'water', name: 'Water', color: '#4f9fca', extruder: 2 },
  { id: 'glacier', name: 'Glaciers', color: '#f4f8f7', extruder: 2 },
  { id: 'ski_run', name: 'Ski runs', color: '#ffffff', extruder: 2 },
  { id: 'ski_lift', name: 'Ski lifts', color: '#5b5148', extruder: 2 },
];
/** Resolve saved groups while keeping old projects compatible. */
export function projectMaterialGroups(project: Pick<Project, 'materials'>): MaterialGroup[] {
  const legacyFeatures = project.materials?.find(group => group.id === 'features');
  return defaultMaterialGroups.map(fallback => {
    const saved = project.materials?.find(group => group.id === fallback.id);
    const inherited = fallback.id === 'terrain' ? undefined : legacyFeatures;
    return {
      ...fallback,
      ...(inherited ? { color: inherited.color, extruder: inherited.extruder } : {}),
      ...(saved || {}),
    };
  });
}
/** Resolve one terrain or feature-class material assignment. */
export function projectMaterialGroup(
  project: Pick<Project, 'materials'>,
  id: 'terrain' | FeatureClass,
) {
  return projectMaterialGroups(project).find(group => group.id === id)!;
}
/** Complete editable project persisted in .contour.json and preset packs. */
export interface Project {
  annotations?: import('./annotations').Annotation[];
  extent_editor?: import('./extent-shapes').ExtentEditorState;
  winter_mode?: boolean;
  materials?: MaterialGroup[];
  schema_version: 2;
  name: string;
  grid: Grid;
  source: Source;
  features: Feature[];
  settings: Settings;
}
/** Elevation product choices exposed by the source selector. */
export type Product =
  'auto' | 'usgs_3dep_10m' | 'usgs_3dep_30m' | 'copernicus_glo30' | 'copernicus_glo90';

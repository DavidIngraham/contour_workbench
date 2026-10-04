/** Compile-time and test-time parity manifest for Rust/TypeScript serialized geometry contracts. */
import type {
  AreaPolygon,
  Feature,
  Grid,
  Layout,
  Mesh,
  ManufacturingMode,
  InsertSurfaceMode,
  Overlay,
  Piece,
  Settings,
  Terrain,
  Treatment,
  ZoneSurface,
} from './types';

export const serializedContract = {
  fields: {
    Settings: [
      'manufacturing_mode',
      'insert_surface_mode',
      'insert_proud_height_mm',
      'insert_inset_depth_mm',
      'max_print_size_mm',
      'height_factor',
      'base_height_mm',
      'path_width_mm',
      'path_clearance_mm',
      'feature_edge_clearance_mm',
      'nozzle_diameter_mm',
      'minimum_terrain_island_width_mm',
      'insert_fit_clearance_per_side_mm',
      'insert_elephant_foot_relief_mm',
      'insert_elephant_foot_height_mm',
      'insert_draft_angle_deg',
      'insert_depth_mm',
      'zone_insert_depth_mm',
      'zone_floor_mm',
      'ski_run_width_m',
      'carve_depth_mm',
      'insert_gap_mm',
      'insert_segment_size_mm',
      'terrain_max_error_mm',
      'boundary',
    ],
    Grid: ['bounds', 'width', 'height', 'elevations'],
    AreaPolygon: ['outer', 'holes'],
    Feature: [
      'id',
      'name',
      'class',
      'lines',
      'polygons',
      'enabled',
      'treatment',
      'surface',
      'width_m',
      'insert_depth_mm',
      'tags',
    ],
    Layout: [
      'bounds',
      'width',
      'depth',
      'scale',
      'rotated',
      'minimum',
      'height_factor',
      'base_height',
    ],
    Mesh: ['positions', 'indices'],
    Terrain: ['mesh', 'layout', 'source_samples', 'retained_samples'],
    Overlay: ['treatment', 'id', 'class', 'surface_offset_mm', 'mesh'],
    Piece: ['id', 'class', 'mesh', 'origin', 'insert_depth_mm', 'surface_offset_mm', 'conformal'],
    Plan: ['terrain', 'inserts', 'cutters', 'cutter_group_ends', 'removed_terrain_islands'],
  },
  enums: {
    ManufacturingMode: ['separate', 'multicolor'],
    InsertSurfaceMode: ['proud', 'flush', 'inset'],
    Treatment: ['insert', 'hide', 'v_carve'],
    ZoneSurface: ['terrain', 'level'],
  },
} as const;

type ExactKeys<T, Keys extends readonly PropertyKey[], Ignored extends keyof T = never> =
  Exclude<keyof T, Keys[number] | Ignored> extends never
    ? Exclude<Keys[number], keyof T> extends never
      ? true
      : false
    : false;
type Assert<T extends true> = T;

const settingsMatch: Assert<ExactKeys<Settings, typeof serializedContract.fields.Settings>> = true;
const gridMatch: Assert<ExactKeys<Grid, typeof serializedContract.fields.Grid>> = true;
const areaMatch: Assert<ExactKeys<AreaPolygon, typeof serializedContract.fields.AreaPolygon>> =
  true;
const featureMatch: Assert<ExactKeys<Feature, typeof serializedContract.fields.Feature>> = true;
const layoutMatch: Assert<ExactKeys<Layout, typeof serializedContract.fields.Layout>> = true;
const meshMatch: Assert<ExactKeys<Mesh, typeof serializedContract.fields.Mesh>> = true;
const terrainMatch: Assert<ExactKeys<Terrain, typeof serializedContract.fields.Terrain>> = true;
const overlayMatch: Assert<ExactKeys<Overlay, typeof serializedContract.fields.Overlay>> = true;
const pieceMatch: Assert<
  ExactKeys<
    Piece,
    typeof serializedContract.fields.Piece,
    'taper_relief_mm' | 'taper_height_mm' | 'draft_angle_deg'
  >
> = true;
const manufacturingModeValues: readonly ManufacturingMode[] =
  serializedContract.enums.ManufacturingMode;
const insertSurfaceModeValues: readonly InsertSurfaceMode[] =
  serializedContract.enums.InsertSurfaceMode;
const treatmentValues: readonly Treatment[] = serializedContract.enums.Treatment;
const surfaceValues: readonly ZoneSurface[] = serializedContract.enums.ZoneSurface;

void [
  settingsMatch,
  gridMatch,
  areaMatch,
  featureMatch,
  layoutMatch,
  meshMatch,
  terrainMatch,
  overlayMatch,
  pieceMatch,
  manufacturingModeValues,
  insertSurfaceModeValues,
  treatmentValues,
  surfaceValues,
];

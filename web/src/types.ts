export type Bounds = [number,number,number,number];
export interface Grid {bounds:Bounds;width:number;height:number;elevations:number[]}
export interface Settings {max_print_size_mm:[number,number];height_factor:number;base_height_mm:number;path_width_mm:number;path_clearance_mm:number;nozzle_diameter_mm:number;insert_fit_clearance_per_side_mm:number;insert_elephant_foot_relief_mm:number;insert_elephant_foot_height_mm:number;insert_draft_angle_deg:number;insert_depth_mm:number;zone_insert_depth_mm:number;zone_floor_mm:number;ski_run_width_m:number;carve_depth_mm:number;insert_gap_mm:number;insert_segment_size_mm:number|null;terrain_max_error_mm:number;boundary:[number,number][]}
export const defaults:Settings={max_print_size_mm:[248,198],height_factor:1,base_height_mm:1,path_width_mm:.9,path_clearance_mm:.1,nozzle_diameter_mm:.4,insert_fit_clearance_per_side_mm:.15,insert_elephant_foot_relief_mm:.18,insert_elephant_foot_height_mm:.4,insert_draft_angle_deg:1.5,insert_depth_mm:2,zone_insert_depth_mm:.8,zone_floor_mm:.8,ski_run_width_m:30,carve_depth_mm:.4,insert_gap_mm:.5,insert_segment_size_mm:null,terrain_max_error_mm:0,boundary:[]};
export type Treatment = 'insert'|'hide'|'v_carve';
export type FeatureClass='trail'|'road'|'stream'|'water'|'glacier'|'ski_run'|'ski_lift';
export type ZoneSurface='terrain'|'level';
export interface AreaPolygon {outer:[number,number][];holes:[number,number][][]}
export interface Feature {treatment?:Treatment;id:string;name:string;class:FeatureClass;lines:[number,number][][];polygons?:AreaPolygon[];enabled:boolean;tags:Record<string,unknown>;surface?:ZoneSurface;width_m?:number;insert_depth_mm?:number}
export interface Mesh {positions:number[]|Float32Array;indices:number[]|Uint32Array}
export interface Layout {bounds:Bounds;width:number;depth:number;scale:number;rotated:boolean;minimum:number;height_factor:number;base_height:number}
export interface Terrain {mesh:Mesh;layout:Layout;source_samples:number;retained_samples:number}
export interface Overlay {treatment:Treatment;id:string;class:Feature['class'];mesh:Mesh}
export interface Piece {id:string;class:string;mesh:Mesh;origin:[number,number,number];insert_depth_mm:number;conformal?:boolean;taper_relief_mm?:number;taper_height_mm?:number;draft_angle_deg?:number}
export interface Asset {terrain:Mesh;inserts:Piece[];validation:{watertight:boolean;triangles:number;pieces:number};revision:number}
export interface Source {product:string;name:string;retrieved:string;attribution:string;urls?:string[];bundled?:boolean}
export interface Project {annotations?:import('./annotations').Annotation[];extent_editor?:import('./extent-shapes').ExtentEditorState;winter_mode?:boolean;schema_version:2;name:string;grid:Grid;source:Source;features:Feature[];settings:Settings}
export type Product='auto'|'usgs_3dep_10m'|'usgs_3dep_30m'|'copernicus_glo30'|'copernicus_glo90';

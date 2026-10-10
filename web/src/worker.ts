/** Geometry worker: owns the Rust terrain session and Manifold solids off the UI thread. */
/// <reference lib="webworker" />
import { annotationGeometry, type Annotation } from './annotations';
import { calibrationSwitchbackCenterlineMm } from './calibration-path';
import { calibrationClearances, fitProfile, insetAtHeight } from './insert-fit';
import { insetCrossSection, shouldTaperInsert } from './insert-taper';
import { decodeMeshPacket } from './mesh-packet';
import { finalBuildMemoryPlan } from './memory-plan';
import { assemblePaintedSurface, paintedBuildInputs } from './painted-surface';
import init, * as core from './wasm/contour_wasm';
import { zipSync, strToU8 } from 'fflate';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  combineMeshes,
  loadManifold,
  solidFromMesh,
  trustedManifoldMesh,
  validatedMesh,
} from './manifold-adapter';
import {
  isEngineCancelRequest,
  isEngineRequest,
  type EngineProgress,
  type EngineRequest,
} from './engine-contract';
import type {
  Grid,
  Settings,
  Feature,
  Terrain,
  Overlay,
  Mesh,
  Asset,
  Piece,
  Project,
} from './types';

const ready = init();
let rust: core.TerrainSession | undefined;
let grid: Grid,
  settings: Settings,
  terrain: Terrain,
  features: Feature[] = [];
let terrainBuilds = 0;
type TerrainPacketMetadata = Omit<Terrain, 'mesh'>;
type OverlayPacketMetadata = Omit<Overlay, 'mesh'>;
type PiecePacketMetadata = Omit<Piece, 'mesh'>;
interface PlanPacketMetadata {
  terrain_triangles: number;
  inserts: PiecePacketMetadata[];
  cutter_batches: number;
  insert_batches: number;
  removed_terrain_islands: number;
}
interface MeshBatchPacketMetadata {
  batch_index: number;
  batch_total: number;
  start_index: number;
  done: boolean;
}
function setGrid(next: Grid) {
  const nextRust = new core.TerrainSession(JSON.stringify(next));
  rust?.free();
  rust = nextRust;
  grid = next;
}
function packed(m: Mesh): Mesh {
  return { positions: new Float32Array(m.positions), indices: new Uint32Array(m.indices) };
}
function meshBytes(m: Mesh) {
  const positions = Float32Array.from(m.positions),
    indices = Uint32Array.from(m.indices),
    out = new Uint8Array(8 + positions.byteLength + indices.byteLength),
    view = new DataView(out.buffer);
  view.setUint32(0, positions.length, true);
  view.setUint32(4, indices.length, true);
  out.set(new Uint8Array(positions.buffer), 8);
  out.set(new Uint8Array(indices.buffer), 8 + positions.byteLength);
  return out;
}
function stl(m: Mesh) {
  let out = 'solid contour_workbench\n';
  for (let i = 0; i < m.indices.length; i += 3) {
    out += 'facet normal 0 0 0\nouter loop\n';
    for (let k = 0; k < 3; k++) {
      const j = m.indices[i + k] * 3;
      out += `vertex ${m.positions[j]} ${m.positions[j + 1]} ${m.positions[j + 2]}\n`;
    }
    out += 'endloop\nendfacet\n';
  }
  return strToU8(out + 'endsolid contour_workbench\n');
}
function taperedSolid(
  M: ManifoldToplevel,
  prism: Manifold,
  className: string,
  s: Settings,
  depthMm: number,
  reliefOverride?: number,
) {
  const bounds = prism.boundingBox(),
    totalDepth = bounds.max[2] - bounds.min[2],
    profile = fitProfile(s, className, Math.min(depthMm, totalDepth), reliefOverride);
  if (profile.maximumInsetMm <= 1e-7) return { solid: prism, profile };
  const epsilon = Math.min(0.001, totalDepth / 100),
    section = prism.slice(bounds.min[2] + epsilon),
    layerMm = Math.max(0.1, Math.min(0.25, s.nozzle_diameter_mm / 2));
  const profiledDepth = Math.min(totalDepth, profile.depthMm),
    divisions = Math.max(1, Math.ceil(profiledDepth / layerMm)),
    bands: Manifold[] = [];
  try {
    for (let i = 0; i < divisions; i++) {
      const z0 = (profiledDepth * i) / divisions,
        z1 = (profiledDepth * (i + 1)) / divisions,
        { cross, owned } = insetCrossSection(section, insetAtHeight(profile, z0));
      bands.push(cross.extrude(z1 - z0 + 0.0002).translate([0, 0, bounds.min[2] + z0 - 0.0001]));
      if (owned) cross.delete();
    }
    if (totalDepth > profiledDepth - 0.0001)
      bands.push(
        section
          .extrude(totalDepth - profiledDepth + 0.0002)
          .translate([0, 0, bounds.min[2] + profiledDepth - 0.0001]),
      );
    if (!bands.length) return { solid: prism, profile };
    const envelope = M.Manifold.union(bands),
      tapered = envelope.intersect(prism);
    envelope.delete();
    if (tapered.status() !== 'NoError' || tapered.isEmpty()) {
      tapered.delete();
      return { solid: prism, profile };
    }
    return { solid: tapered, profile };
  } finally {
    section.delete();
    bands.forEach(b => b.delete());
  }
}
function safeTaperedSolid(
  M: ManifoldToplevel,
  prism: Manifold,
  className: string,
  s: Settings,
  depthMm: number,
) {
  for (const factor of [1, 0.75, 0.5, 0.25]) {
    const adjusted = { ...s, insert_draft_angle_deg: s.insert_draft_angle_deg * factor };
    let candidate;
    try {
      candidate = taperedSolid(
        M,
        prism,
        className,
        adjusted,
        depthMm,
        s.insert_elephant_foot_relief_mm * factor,
      );
    } catch {
      continue;
    }
    if (candidate.solid === prism) continue;
    try {
      validatedMesh(candidate.solid, 'Taper check');
      return candidate;
    } catch {
      candidate.solid.delete();
    }
  }
  const adjusted = {
    ...s,
    insert_elephant_foot_relief_mm: 0,
    insert_elephant_foot_height_mm: 0,
    insert_draft_angle_deg: 0,
  };
  return { solid: prism, profile: fitProfile(adjusted, className, depthMm, 0) };
}

const digitSegments: Record<string, string> = { 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg' };
function digitCutters(
  M: ManifoldToplevel,
  digit: string,
  cx: number,
  cy: number,
  z: number,
): Manifold[] {
  const map: { [key: string]: [number, number, number, number] } = {
    a: [0, 2, 2.4, 0.42],
    g: [0, 0, 2.4, 0.42],
    d: [0, -2, 2.4, 0.42],
    f: [-1.2, 1, 0.42, 1.8],
    b: [1.2, 1, 0.42, 1.8],
    e: [-1.2, -1, 0.42, 1.8],
    c: [1.2, -1, 0.42, 1.8],
  };
  return [...(digitSegments[digit] || '')].map(key => {
    const [x, y, w, h] = map[key];
    return M.Manifold.cube([w, h, 0.6]).translate([cx + x - w / 2, cy + y - h / 2, z]);
  });
}
function switchbackSolid(
  M: ManifoldToplevel,
  cx: number,
  cy: number,
  widthMm: number,
  heightMm: number,
  zMm: number,
) {
  const points = calibrationSwitchbackCenterlineMm.map(
      ([x, y]) => [x + cx, y + cy] as [number, number],
    ),
    parts: Manifold[] = [];
  try {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1],
        [x1, y1] = points[i],
        dx = x1 - x0,
        dy = y1 - y0,
        length = Math.hypot(dx, dy),
        angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      parts.push(
        M.Manifold.cube([length, widthMm, heightMm])
          .translate([-length / 2, -widthMm / 2, 0])
          .rotate([0, 0, angle])
          .translate([(x0 + x1) / 2, (y0 + y1) / 2, zMm]),
      );
    }
    for (const [x, y] of points)
      parts.push(
        M.Manifold.cylinder(heightMm, widthMm / 2, widthMm / 2, 16).translate([x, y, zMm]),
      );
    return M.Manifold.union(parts);
  } finally {
    parts.forEach(part => part.delete());
  }
}
function calibrationFiles(
  M: ManifoldToplevel,
  s: Settings,
  prefix = 'calibration/',
): Record<string, Uint8Array> {
  const clearances = calibrationClearances(s),
    centers = [14, 38, 62, 86],
    pathWidth = Math.max(0.05, s.path_width_mm);
  let base = M.Manifold.cube([100, 38, 3]);
  const cutters: Manifold[] = [];
  try {
    clearances.forEach((clearance, index) => {
      cutters.push(switchbackSolid(M, centers[index], 12, pathWidth + 2 * clearance, 2.2, 1));
      cutters.push(...digitCutters(M, String(index + 1), centers[index], 32, 2.7));
    });
    const combined = M.Manifold.union(cutters),
      cut = base.subtract(combined);
    base.delete();
    base = cut;
    combined.delete();
    const files: Record<string, Uint8Array> = {
        [prefix + 'coupon-base.stl']: stl(validatedMesh(base, 'Calibration coupon base')),
      },
      pieces: {
        label: number;
        clearance_per_side_mm: number;
        file: string;
        geometry: string;
        path_width_mm: number;
      }[] = [];
    clearances.forEach((clearance, index) => {
      const prism = switchbackSolid(M, 8, 6.2, pathWidth, 2, 0),
        tapered = safeTaperedSolid(M, prism, 'trail', s, 2);
      files[`${prefix}insert-${index + 1}-clearance-${clearance.toFixed(2)}mm.stl`] = stl(
        validatedMesh(tapered.solid, `Calibration switchback insert ${index + 1}`),
      );
      if (tapered.solid !== prism) tapered.solid.delete();
      prism.delete();
      pieces.push({
        label: index + 1,
        clearance_per_side_mm: clearance,
        file: `insert-${index + 1}-clearance-${clearance.toFixed(2)}mm.stl`,
        geometry: 'trail_switchback',
        path_width_mm: pathWidth,
      });
    });
    files[prefix + 'calibration_manifest.json'] = strToU8(
      JSON.stringify(
        {
          units: 'mm',
          geometry: 'trail_switchback',
          path_width_mm: pathWidth,
          nozzle_diameter_mm: s.nozzle_diameter_mm,
          elephant_foot_relief_mm: s.insert_elephant_foot_relief_mm,
          elephant_foot_height_mm: s.insert_elephant_foot_height_mm,
          draft_angle_deg: s.insert_draft_angle_deg,
          pieces,
        },
        null,
        2,
      ),
    );
    files[prefix + 'README.txt'] = strToU8(
      'CONTOUR WORKBENCH SWITCHBACK FIT TEST\n\nThis coupon uses narrow trail geometry with close parallel runs, tight hairpins, and an angled jog. It exposes first-layer swelling, fused switchback gaps, corner loss, and clearance problems that a rectangular coupon can miss.\n\nPrint coupon-base.stl normally. Print each numbered switchback insert with its flat, narrow end on the build plate. Match insert numbers to the engraved numbers beside the pockets. Choose the smallest number that seats through every turn without force, then enter its clearance-per-side value in Print setup.\n\nConfigured path width: ' +
        pathWidth.toFixed(2) +
        ' mm\nConfigured nozzle: ' +
        s.nozzle_diameter_mm.toFixed(2) +
        ' mm\n\n' +
        pieces
          .map(p => `${p.label}: ${p.clearance_per_side_mm.toFixed(2)} mm clearance per side\n`)
          .join(''),
    );
    return files;
  } finally {
    base.delete();
    cutters.forEach(c => c.delete());
  }
}
function syncBase(next: Settings) {
  if (!terrain) return;
  const delta = next.base_height_mm - terrain.layout.base_height;
  if (delta) {
    for (let i = 2; i < terrain.mesh.positions.length; i += 3)
      if (terrain.mesh.positions[i] > 0) terrain.mesh.positions[i] += delta;
    terrain.layout.base_height = next.base_height_mm;
  }
}
type Progress = (message: string, phase?: string, completed?: number, total?: number) => void;

const canceledRequests = new Set<number>();

async function checkpoint(id: number) {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (canceledRequests.delete(id)) throw new DOMException('Operation canceled', 'AbortError');
}

async function handle(request: EngineRequest, progress: Progress): Promise<unknown> {
  await ready;
  const { type, payload: p } = request;
  switch (type) {
    case 'hydrate':
      setGrid(p.project.grid);
      settings = p.project.settings;
      features = p.project.features;
      terrain = p.terrain;
      return true;
    case 'classify':
      return JSON.parse(core.classify_features(JSON.stringify(p)));
    case 'urls':
      return JSON.parse(core.source_urls(JSON.stringify(p.bounds), p.ninety));
    case 'query':
      return core.osm_query(JSON.stringify(p.bounds ?? p), Boolean(p.winter));
    case 'terrain': {
      setGrid(p.grid);
      settings = p.settings;
      features = p.features;
      progress('Creating your terrain…');
      const packet = decodeMeshPacket<TerrainPacketMetadata>(
        rust!.build_terrain(JSON.stringify(settings)),
      );
      if (packet.meshes.length !== 1)
        throw new Error('Terrain geometry packet did not contain one mesh.');
      terrain = { ...packet.metadata, mesh: packet.meshes[0] };
      terrainBuilds++;
      return { ...terrain, mesh: packed(terrain.mesh), terrainBuilds };
    }
    case 'overlays': {
      syncBase(p.settings);
      features = p.features;
      settings = p.settings;
      progress('Adding trails, water, and map details…');
      const packet = decodeMeshPacket<OverlayPacketMetadata[]>(
        rust!.build_overlays(
          JSON.stringify(settings),
          JSON.stringify(features),
          JSON.stringify(terrain.layout),
        ),
      );
      if (packet.metadata.length !== packet.meshes.length)
        throw new Error('Overlay geometry packet is inconsistent.');
      return packet.metadata.map((overlay, index) => ({ ...overlay, mesh: packet.meshes[index] }));
    }
    case 'generate': {
      if (!terrain) throw new Error('Load terrain first');
      syncBase(p.settings);
      features = p.features;
      settings = p.settings;
      const memory = finalBuildMemoryPlan(
        grid.elevations.length,
        terrain.mesh.indices.length / 3,
        features.filter(feature => feature.enabled).length,
        settings.terrain_max_error_mm,
        p.memory_budget_mb,
      );
      let buildSettings = memory.adapted
        ? { ...settings, terrain_max_error_mm: memory.terrainMaxErrorMm }
        : settings;
      let buildFeatures = features;
      if (settings.manufacturing_mode === 'multicolor') {
        const inputs = paintedBuildInputs(buildSettings, features);
        buildSettings = inputs.settings;
        buildFeatures = inputs.features;
      }
      progress(
        memory.adapted
          ? 'Optimizing this detailed model for your device…'
          : 'Creating the printable model…',
        'memory-preflight',
        0,
        1,
      );
      const metadata = JSON.parse(
        rust!.prepare_plan(
          JSON.stringify(buildSettings),
          JSON.stringify(buildFeatures),
          JSON.stringify(terrain.layout),
          150_000,
          64,
        ),
      ) as PlanPacketMetadata;
      const plan: {
        inserts: Piece[];
        removed_terrain_islands: number;
      } = {
        inserts: metadata.inserts.map(piece => ({
          ...piece,
          mesh: { positions: new Float32Array(), indices: new Uint32Array() },
        })),
        removed_terrain_islands: metadata.removed_terrain_islands,
      };
      progress('Preparing the terrain for final assembly…', 'terrain-transfer', 0, 1);
      const terrainPacket = decodeMeshPacket<null>(rust!.take_plan_terrain());
      if (terrainPacket.meshes.length !== 1)
        throw new Error('Final terrain packet is inconsistent.');
      let directTerrain = terrainPacket.meshes[0];
      if (directTerrain.indices.length / 3 !== metadata.terrain_triangles)
        throw new Error('Final terrain metadata is inconsistent.');
      const M = await loadManifold(progress);
      let result = solidFromMesh(M, directTerrain);
      directTerrain = { positions: new Float32Array(), indices: new Uint32Array() };
      let resultDeleted = false;
      let raisedTerrain: Manifold | undefined;
      let raisedTerrainOffset: number | undefined;
      try {
        try {
          for (;;) {
            const batch = decodeMeshPacket<MeshBatchPacketMetadata>(rust!.take_plan_cutter_batch());
            if (!batch.meshes.length) break;
            progress(
              (settings.manufacturing_mode === 'separate'
                ? 'Making spaces for separate pieces… '
                : 'Separating material regions… ') +
                batch.metadata.batch_index +
                ' of ' +
                batch.metadata.batch_total +
                '\u2026',
              'terrain-pockets',
              batch.metadata.batch_index,
              batch.metadata.batch_total,
            );
            await checkpoint(request.id);
            const combined = solidFromMesh(M, combineMeshes(batch.meshes));
            batch.meshes.length = 0;
            try {
              const next = result.subtract(combined);
              result.delete();
              result = next;
            } finally {
              combined.delete();
            }
            if (result.status() !== 'NoError' || result.numTri() === 0)
              throw new Error(
                'Pocket batch ' +
                  batch.metadata.batch_index +
                  ' did not produce a valid terrain solid',
              );
            if (batch.metadata.done) break;
          }
        } catch (error) {
          throw new Error(
            'Terrain pockets: ' + (error instanceof Error ? error.message : String(error)),
          );
        }
        if (result.status() !== 'NoError' || result.numTri() === 0)
          throw new Error('Terrain operation did not produce a valid solid');

        if (p.annotations?.length) {
          progress('Adding labels and raised details…');
          for (const a of p.annotations as Annotation[]) {
            if (!a.enabled) continue;
            const data = annotationGeometry(a, grid, settings, terrain.layout);
            if (data.porch) {
              await checkpoint(request.id);
              const porch = solidFromMesh(M, data.porch),
                next = result.add(porch);
              porch.delete();
              result.delete();
              result = next;
            }
            const parts = data.solids.map(mesh => solidFromMesh(M, mesh));
            try {
              const label = M.Manifold.union(parts),
                next = a.treatment === 'raised' ? result.add(label) : result.subtract(label);
              label.delete();
              result.delete();
              result = next;
            } finally {
              parts.forEach(m => m.delete());
            }
            if (result.status() !== 'NoError')
              throw new Error(
                'Annotation ' + a.name + ' could not form a solid. Move it or adjust its size.',
              );
          }
        }
        progress('Checking that the model is ready to print…', 'terrain-validation');
        let mesh = trustedManifoldMesh(result, 'Terrain');
        result.delete();
        resultDeleted = true;

        let preparedPieces = 0;
        for (;;) {
          const insertBatch = decodeMeshPacket<MeshBatchPacketMetadata>(
            rust!.take_plan_insert_batch(),
          );
          if (!insertBatch.meshes.length) {
            if (insertBatch.metadata.done) break;
            throw new Error('Model insert packet is empty.');
          }
          if (insertBatch.metadata.start_index !== preparedPieces)
            throw new Error('Model insert batches are out of order.');
          for (let batchIndex = 0; batchIndex < insertBatch.meshes.length; batchIndex++) {
            const pieceIndex = insertBatch.metadata.start_index + batchIndex,
              piece = plan.inserts[pieceIndex];
            if (!piece) throw new Error('Model insert packet is inconsistent.');
            piece.mesh = insertBatch.meshes[batchIndex];
            if (pieceIndex % 10 === 0)
              progress(
                (settings.manufacturing_mode === 'separate'
                  ? 'Preparing separate pieces… '
                  : 'Preparing painted surface regions… ') +
                  (pieceIndex + 1) +
                  ' of ' +
                  plan.inserts.length,
                'inserts',
                pieceIndex + 1,
                plan.inserts.length,
              );
            try {
              await checkpoint(request.id);
              const prism = solidFromMesh(M, piece.mesh),
                tapered =
                  settings.manufacturing_mode === 'separate' &&
                  shouldTaperInsert(piece.mesh.indices.length)
                    ? safeTaperedSolid(M, prism, piece.class, settings, piece.insert_depth_mm)
                    : {
                        solid: prism,
                        profile: fitProfile(
                          {
                            ...settings,
                            insert_elephant_foot_relief_mm: 0,
                            insert_elephant_foot_height_mm: 0,
                            insert_draft_angle_deg: 0,
                          },
                          piece.class,
                          piece.insert_depth_mm,
                          0,
                        ),
                      };
              let raw = tapered.solid;
              try {
                piece.taper_relief_mm = tapered.profile.footReliefMm;
                piece.taper_height_mm = tapered.profile.footHeightMm;
                piece.draft_angle_deg = tapered.profile.draftAngleDeg;
                if (piece.conformal) {
                  const surfaceOffsetMm =
                    piece.surface_offset_mm ?? settings.insert_relative_height_mm;
                  if (
                    !raisedTerrain ||
                    raisedTerrainOffset === undefined ||
                    Math.abs(raisedTerrainOffset - surfaceOffsetMm) > 1e-9
                  ) {
                    raisedTerrain?.delete();
                    const originalTerrain = solidFromMesh(M, terrain.mesh);
                    try {
                      raisedTerrain = originalTerrain.translate([0, 0, surfaceOffsetMm]);
                      raisedTerrainOffset = surfaceOffsetMm;
                    } finally {
                      originalTerrain.delete();
                    }
                  }
                  const global = tapered.solid.translate(piece.origin),
                    fitted = global.intersect(raisedTerrain);
                  global.delete();
                  raw = fitted.translate(piece.origin.map(v => -v) as [number, number, number]);
                  fitted.delete();
                }
                piece.mesh = validatedMesh(raw, piece.id);
              } finally {
                if (raw !== tapered.solid) raw.delete();
                if (tapered.solid !== prism) tapered.solid.delete();
                prism.delete();
              }
            } catch (error) {
              throw new Error(
                piece.id +
                  ' (' +
                  (pieceIndex + 1) +
                  '/' +
                  plan.inserts.length +
                  '): ' +
                  (error instanceof Error ? error.message : String(error)),
              );
            }
          }
          preparedPieces += insertBatch.meshes.length;
          insertBatch.meshes.length = 0;
          if (insertBatch.metadata.done) break;
        }
        if (preparedPieces !== plan.inserts.length)
          throw new Error('Model insert packet is inconsistent.');
        plan.inserts = plan.inserts.filter(piece => piece.mesh.indices.length > 0);
        let faceMaterials: Uint8Array | undefined;
        if (settings.manufacturing_mode === 'multicolor') {
          progress('Merging the painted exterior…');
          const painted = await assemblePaintedSurface(M, mesh, plan.inserts, () =>
            checkpoint(request.id),
          );
          mesh = painted.mesh;
          faceMaterials = painted.faceMaterials;
          plan.inserts = [];
        }
        return {
          terrain: mesh,
          faceMaterials,
          inserts: plan.inserts,
          validation: {
            watertight: true,
            triangles: mesh.indices.length / 3,
            pieces: plan.inserts.length,
            removed_terrain_islands: plan.removed_terrain_islands,
            terrain_max_error_mm: memory.adapted ? memory.terrainMaxErrorMm : undefined,
            insert_relative_height_mm: settings.insert_relative_height_mm,
          },
          revision: p.revision,
        };
      } finally {
        if (!resultDeleted) result.delete();
        raisedTerrain?.delete();
        rust?.clear_plan();
      }
    }
    case 'preset-pack': {
      if (!terrain) throw new Error('Build terrain before packing a preset.');
      const project = p.project as Project,
        packet = decodeMeshPacket<OverlayPacketMetadata[]>(
          rust!.build_overlays(
            JSON.stringify(project.settings),
            JSON.stringify(project.features),
            JSON.stringify(terrain.layout),
          ),
        );
      if (packet.metadata.length !== packet.meshes.length)
        throw new Error('Preset overlay geometry packet is inconsistent.');
      const raw = packet.metadata.map((overlay, index) => ({
        ...overlay,
        mesh: packet.meshes[index],
      })) as Overlay[];
      const files: Record<string, Uint8Array> = {},
        terrainFile = 'terrain.mesh';
      files[terrainFile] = meshBytes(terrain.mesh);
      const packedOverlays = raw.map((overlay, index) => {
        const file = `overlays/${index}.mesh`;
        files[file] = meshBytes(overlay.mesh);
        return { ...overlay, mesh: file };
      });
      files['manifest.json'] = strToU8(
        JSON.stringify({
          version: 1,
          project,
          terrain: { ...terrain, mesh: terrainFile },
          overlays: packedOverlays,
        }),
      );
      return zipSync(files, { level: 6 });
    }
    case 'calibration': {
      const M = await loadManifold(progress);
      progress('Creating fit-test pieces for your printer…');
      return zipSync(calibrationFiles(M, p.settings as Settings, ''), { level: 3 });
    }
    default:
      throw new Error('Unknown operation');
  }
}
self.onmessage = async (event: MessageEvent<unknown>) => {
  if (isEngineCancelRequest(event.data)) {
    canceledRequests.add(event.data.cancel);
    return;
  }
  if (!isEngineRequest(event.data)) return;
  const request = event.data;
  try {
    const result = await handle(request, (message, phase, completed, total) => {
      const progress: EngineProgress = { message, phase, completed, total };
      self.postMessage({ id: request.id, progress });
    });
    const transfers: Transferable[] = [];
    const visit = (value: unknown) => {
      if (ArrayBuffer.isView(value)) transfers.push(value.buffer as ArrayBuffer);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(result);
    self.postMessage({ id: request.id, result }, [...new Set(transfers)]);
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    canceledRequests.delete(request.id);
  }
};

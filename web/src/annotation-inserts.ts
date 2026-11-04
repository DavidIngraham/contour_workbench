/** Final annotation insert booleans, owned and released by the geometry worker. */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  annotationMesh,
  annotationPoint,
  type Annotation,
  type annotationGeometry,
} from './annotations';
import type { Piece, Settings } from './types';
import type { FitProfile } from './insert-fit';
import { extrusionWidthMm } from './insert-fit';
import { supportsExtrusion } from './insert-taper';
import { compactManifoldMesh, solidFromMesh, validatedMesh } from './manifold-adapter';

/** Require a continuous wall behind bottom/side artwork, including between sample points. */
export function assertFaceAnnotationBacking(
  annotation: Annotation,
  geometry: ReturnType<typeof annotationGeometry>,
  label: Manifold,
  terrain: Manifold,
) {
  if (annotation.placement !== 'bottom' && annotation.placement !== 'side') return;
  const frame = geometry.frame;
  const local = label.warp(p => {
    const q = annotationPoint(frame, p, true);
    p[0] = q[0];
    p[1] = q[1];
    p[2] = q[2];
  });
  const footprint = local.project();
  const depth = annotation.treatment === 'engraved' ? annotation.depth_mm : 0;
  let source: Manifold | undefined,
    seat: Manifold | undefined,
    world: Manifold | undefined,
    missing: Manifold | undefined;
  try {
    source = footprint.extrude(depth + 0.4);
    seat = source.translate([0, 0, -depth - 0.4]);
    world = seat.warp(p => {
      const q = annotationPoint(frame, p);
      p[0] = q[0];
      p[1] = q[1];
      p[2] = q[2];
    });
    missing = world.subtract(terrain);
    if (missing.volume() > Math.max(0.00001, world.volume() * 0.0001))
      throw new Error(
        'Fit the annotation on a solid model face with at least 0.4 mm of backing. Move it or reduce its size or depth.',
      );
  } finally {
    missing?.delete();
    world?.delete();
    seat?.delete();
    source?.delete();
    footprint.delete();
    local.delete();
  }
}

/** Build a flat treatment from actual native terrain triangles, retaining borrowed inputs. */
export function flatAnnotationSolid(
  annotation: Annotation,
  geometry: ReturnType<typeof annotationGeometry>,
  label: Manifold,
  terrain: Manifold,
) {
  const footprint = label.project();
  let source: Manifold | undefined,
    column: Manifold | undefined,
    fitted: Manifold | undefined,
    extrusion: Manifold | undefined;
  try {
    source = footprint.extrude(terrain.boundingBox().max[2] + 2 - 0.3);
    column = source.translate([0, 0, 0.3]);
    fitted = terrain.intersect(column);
    const mesh = compactManifoldMesh(fitted.getMesh());
    let low = Infinity,
      high = -Infinity;
    // Positive-Z faces are the terrain roof. Ignore the clipping column floor
    // and vertical walls when finding a flat floor that reaches every stroke.
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = Array.from(mesh.indices.slice(i, i + 3), index => index * 3);
      const [a, b, c] = ids;
      if (
        (mesh.positions[b] - mesh.positions[a]) * (mesh.positions[c + 1] - mesh.positions[a + 1]) -
          (mesh.positions[b + 1] - mesh.positions[a + 1]) *
            (mesh.positions[c] - mesh.positions[a]) <=
        1e-10
      )
        continue;
      for (const index of ids) {
        low = Math.min(low, mesh.positions[index + 2]);
        high = Math.max(high, mesh.positions[index + 2]);
      }
    }
    if (!Number.isFinite(low)) throw new Error('Move the flat annotation onto solid terrain.');
    const raised = annotation.treatment === 'raised';
    const floor = annotation.as_insert
      ? geometry.floorMm
      : raised
        ? 0.3
        : Math.max(0.4, low - annotation.depth_mm);
    const top = raised ? high + annotation.depth_mm : terrain.boundingBox().max[2] + 2;
    if (annotation.as_insert && low - floor < 0.2 - 1e-6)
      throw new Error(
        'Increase the flat annotation pocket depth to seat every stroke in the terrain.',
      );
    extrusion = footprint.extrude(top - floor);
    return extrusion.translate([0, 0, floor]);
  } finally {
    extrusion?.delete();
    fitted?.delete();
    column?.delete();
    source?.delete();
    footprint.delete();
  }
}

/** Caller owns the returned terrain and pocket; the input terrain remains borrowed. */
export async function buildAnnotationInsert(
  M: ManifoldToplevel,
  annotation: Annotation,
  geometry: ReturnType<typeof annotationGeometry>,
  settings: Settings,
  terrain: Manifold,
  checkpoint: () => Promise<void>,
  taper: (solid: Manifold, depthMm: number) => { solid: Manifold; profile: FitProfile },
) {
  if (annotation.placement !== 'bottom' && annotation.placement !== 'side')
    return buildLocalInsert(M, annotation, geometry, settings, terrain, checkpoint, taper);
  const frame = geometry.frame;
  const localTerrain = terrain.warp(p => {
    const q = annotationPoint(frame, p, true);
    p[0] = q[0];
    p[1] = q[1];
    p[2] = q[2];
  });
  let local: Awaited<ReturnType<typeof buildLocalInsert>> | undefined;
  let result: Manifold | undefined, pocket: Manifold | undefined;
  try {
    local = await buildLocalInsert(
      M,
      annotation,
      { ...geometry, solids: geometry.solids.map(mesh => annotationMesh(frame, mesh, true)) },
      settings,
      localTerrain,
      checkpoint,
      taper,
    );
    const toWorld = (p: number[]) => {
      const q = annotationPoint(frame, p);
      p[0] = q[0];
      p[1] = q[1];
      p[2] = q[2];
    };
    result = local.terrain.warp(toWorld);
    pocket = local.pocket.warp(toWorld);
    return {
      terrain: result,
      pocket,
      pieces: local.pieces.map(piece => ({
        ...piece,
        origin: annotationPoint(frame, piece.origin),
        assembly_basis: [...frame.u, ...frame.v, ...frame.n],
      })),
    };
  } catch (error) {
    result?.delete();
    pocket?.delete();
    throw error;
  } finally {
    local?.terrain.delete();
    local?.pocket.delete();
    localTerrain.delete();
  }
}

async function buildLocalInsert(
  M: ManifoldToplevel,
  annotation: Annotation,
  geometry: ReturnType<typeof annotationGeometry>,
  settings: Settings,
  terrain: Manifold,
  checkpoint: () => Promise<void>,
  taper: (solid: Manifold, depthMm: number) => { solid: Manifold; profile: FitProfile },
) {
  const parts: Manifold[] = [];
  let label: Manifold | undefined;
  let pocket: Manifold | undefined;
  let nextTerrain: Manifold | undefined;
  const pieces: Piece[] = [];
  try {
    for (const [index, mesh] of geometry.solids.entries()) {
      if (index % 64 === 0) await checkpoint();
      parts.push(solidFromMesh(M, mesh));
    }
    label = M.Manifold.union(parts);
    if (label.status() !== 'NoError' || label.isEmpty())
      throw new Error('The annotation could not form solid inserts. Adjust its size or artwork.');
    const footprint = label.project();
    const clearance =
      settings.manufacturing_mode === 'separate' ? settings.insert_fit_clearance_per_side_mm : 0;
    const expanded = footprint.offset(clearance, 'Round', 2, 24);
    try {
      const allowed = terrain.project();
      try {
        const outside = expanded.subtract(allowed);
        try {
          if (outside.area() > 0.00001)
            throw new Error(
              'Move the annotation farther inside the terrain or label platform to leave room for pocket clearance.',
            );
        } finally {
          outside.delete();
        }
      } finally {
        allowed.delete();
      }
      const face = annotation.placement === 'bottom' || annotation.placement === 'side';
      const floor = footprint.extrude(face ? 0.4 - geometry.floorMm : 0.4);
      const seat = floor.translate([0, 0, geometry.floorMm - 0.4]);
      try {
        const missing = seat.subtract(terrain);
        try {
          if (missing.volume() > Math.max(0.00001, seat.volume() * 0.0001))
            throw new Error(
              'The annotation overlaps another pocket or has no solid base. Move it to clear terrain or a label platform.',
            );
        } finally {
          missing.delete();
        }
      } finally {
        seat.delete();
        floor.delete();
      }
      // Clip the artwork against the actual final terrain triangles. Bilinear
      // preview samples can differ from a triangulated mountain surface. Raise
      // only the fitted top, retaining the common flat floor for assembly.
      if (annotation.drape !== false || annotation.placement !== 'terrain') {
        const columnSource = footprint.extrude(terrain.boundingBox().max[2] + 2 - geometry.floorMm);
        const column = columnSource.translate([0, 0, geometry.floorMm]);
        let fitted: Manifold;
        try {
          fitted = terrain.intersect(column);
        } finally {
          column.delete();
          columnSource.delete();
        }
        if (annotation.depth_mm > 0) {
          try {
            const raised = fitted.warp(point => {
              if (point[2] > geometry.floorMm + 0.00001) point[2] += annotation.depth_mm;
            });
            label.delete();
            label = raised;
          } finally {
            fitted.delete();
          }
        } else {
          label.delete();
          label = fitted;
        }
      } else {
        const flat = flatAnnotationSolid(annotation, geometry, label, terrain);
        label.delete();
        label = flat;
      }
      if (label.status() !== 'NoError' || label.isEmpty())
        throw new Error(
          'The annotation could not follow the terrain surface. Move it or increase the pocket depth.',
        );
      const prism = expanded.extrude(
        Math.max(label.boundingBox().max[2], terrain.boundingBox().max[2]) + 2 - geometry.floorMm,
      );
      try {
        pocket = prism.translate([0, 0, geometry.floorMm]);
      } finally {
        prism.delete();
      }
    } finally {
      expanded.delete();
      footprint.delete();
    }
    await checkpoint();
    nextTerrain = terrain.subtract(pocket);
    if (nextTerrain.status() !== 'NoError' || nextTerrain.isEmpty())
      throw new Error('The annotation pocket could not form a solid terrain base.');
    const components = label.decompose();
    components.sort((a, b) => {
      const left = a.boundingBox().min,
        right = b.boundingBox().min;
      return left[0] - right[0] || left[1] - right[1];
    });
    try {
      for (const [index, component] of components.entries()) {
        await checkpoint();
        const origin = component.boundingBox().min;
        const local = component.translate(origin.map(value => -value) as [number, number, number]);
        let fitted: ReturnType<typeof taper> | undefined;
        try {
          fitted =
            settings.manufacturing_mode === 'separate'
              ? taper(local, geometry.insertDepthMm)
              : undefined;
          const solid = fitted?.solid ?? local;
          if (settings.manufacturing_mode === 'separate') {
            const section = solid.slice(0.001);
            try {
              if (!supportsExtrusion(section, extrusionWidthMm(settings.nozzle_diameter_mm)))
                throw new Error(
                  'Some annotation strokes are too narrow to print as inserts. Increase the artwork size or use a bolder font.',
                );
            } finally {
              section.delete();
            }
          }
          pieces.push({
            id: `annotation-${annotation.name}-${annotation.id}-${index + 1}`,
            class: 'annotations',
            origin,
            mesh: validatedMesh(solid, `${annotation.name} insert ${index + 1}`),
            insert_depth_mm: geometry.insertDepthMm,
            surface_offset_mm: annotation.depth_mm,
            taper_relief_mm: fitted?.profile.footReliefMm ?? 0,
            taper_height_mm: fitted?.profile.footHeightMm ?? 0,
            draft_angle_deg: fitted?.profile.draftAngleDeg ?? 0,
          });
        } finally {
          if (fitted && fitted.solid !== local) fitted.solid.delete();
          local.delete();
        }
      }
    } finally {
      components.forEach(component => component.delete());
    }
    return { terrain: nextTerrain, pocket, pieces };
  } catch (error) {
    nextTerrain?.delete();
    pocket?.delete();
    throw error;
  } finally {
    label?.delete();
    parts.forEach(part => part.delete());
  }
}

/** Reject colliding assembly parts instead of silently dropping or overlapping an insert. */
export function assertAnnotationClearance(part: Manifold, pocket: Manifold, name: string) {
  const a = part.boundingBox(),
    b = pocket.boundingBox();
  if (a.min.some((min, axis) => min >= b.max[axis] || a.max[axis] <= b.min[axis])) return;
  const intersection = part.intersect(pocket);
  try {
    if (intersection.volume() > 0.00001)
      throw new Error(
        `Annotation ${name} overlaps another insert. Move the annotation away from other inserts.`,
      );
  } finally {
    intersection.delete();
  }
}

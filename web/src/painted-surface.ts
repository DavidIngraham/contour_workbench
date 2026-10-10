/** Exterior-only material geometry for slicer-painted, print-together models. */
import type { ManifoldToplevel } from 'manifold-3d';
import { compactManifoldMesh, solidFromMesh, validateMesh } from './manifold-adapter';
import { featureClasses, type Mesh, type Piece, type Settings, type Feature } from './types';

/** Stable material indices carried per triangle, independent of filament assignment. */
export const surfaceMaterials = ['terrain', ...featureClasses] as const;

/** Internal partition depth is a construction detail, never a user-specified material depth. */
export function paintedBuildInputs(settings: Settings, features: Feature[]) {
  return {
    settings: { ...settings, insert_depth_mm: 0.8, zone_insert_depth_mm: 0.8 },
    features: features.map(feature => ({ ...feature, insert_depth_mm: undefined })),
  };
}

/** Merge temporary regions and preserve the material of every surviving exterior face. */
export async function assemblePaintedSurface(
  module: ManifoldToplevel,
  terrain: Mesh,
  pieces: Piece[],
  checkpoint: () => Promise<void> = async () => {},
) {
  const original = (mesh: Mesh) => {
    const imported = solidFromMesh(module, mesh);
    // Worker packets use Float32 coordinates. Match coplanar seams within 0.05 µm
    // instead of retaining microscopic internal shells after union.
    const tolerant = imported.setTolerance(0.00005);
    try {
      return tolerant.asOriginal();
    } finally {
      tolerant.delete();
      imported.delete();
    }
  };
  let solid = original(terrain);
  const materialByOriginal = new Map<number, number>([[solid.originalID(), 0]]);
  try {
    for (const piece of pieces) {
      await checkpoint();
      // Overlap the buried floor by 1 µm so a Float32 round trip cannot leave
      // touching-but-disconnected shells. This overlap is consumed by the union.
      const positions = Float32Array.from(piece.mesh.positions);
      for (let index = 2; index < positions.length; index += 3)
        if (Math.abs(positions[index]) < 0.00005) positions[index] -= 0.001;
      const source = original({ positions, indices: piece.mesh.indices });
      const material = surfaceMaterials.indexOf(piece.class as (typeof surfaceMaterials)[number]);
      if (material < 0) {
        source.delete();
        throw new Error(`Unknown painted material: ${piece.class}`);
      }
      materialByOriginal.set(source.originalID(), material);
      const placed = source.translate(piece.origin);
      try {
        const next = solid.add(placed);
        solid.delete();
        solid = next;
        if (solid.status() !== 'NoError') throw new Error('Could not merge the painted surface.');
      } finally {
        placed.delete();
        source.delete();
      }
    }
    const raw = solid.getMesh();
    const mesh = compactManifoldMesh(raw);
    const faceMaterials = new Uint8Array(mesh.indices.length / 3);
    for (let run = 0; run < raw.runOriginalID.length; run++) {
      const material = materialByOriginal.get(raw.runOriginalID[run]);
      if (material === undefined) throw new Error('Painted surface lost its material provenance.');
      faceMaterials.fill(material, raw.runIndex[run] / 3, raw.runIndex[run + 1] / 3);
    }
    const exterior = removeNumericalShells(mesh, faceMaterials);
    validateMesh(exterior.mesh);
    return exterior;
  } finally {
    solid.delete();
  }
}

/** Remove only microscopic closed shells created by rounded, coincident Boolean interfaces. */
export function removeNumericalShells(mesh: Mesh, faceMaterials: Uint8Array) {
  const count = mesh.positions.length / 3;
  const parents = Uint32Array.from({ length: count }, (_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const root = find(mesh.indices[i]);
    parents[find(mesh.indices[i + 1])] = root;
    parents[find(mesh.indices[i + 2])] = root;
  }
  const volumes = new Map<number, { volume: number; area: number }>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const root = find(mesh.indices[i]);
    const a = mesh.indices[i] * 3,
      b = mesh.indices[i + 1] * 3,
      c = mesh.indices[i + 2] * 3;
    const p = mesh.positions;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const measure = volumes.get(root) ?? { volume: 0, area: 0 };
    // Use a component-local origin to avoid cancellation from large model coordinates.
    measure.volume +=
      ((p[a] - p[root * 3]) * nx +
        (p[a + 1] - p[root * 3 + 1]) * ny +
        (p[a + 2] - p[root * 3 + 2]) * nz) /
      6;
    measure.area += Math.hypot(nx, ny, nz) / 2;
    volumes.set(root, measure);
  }
  if (volumes.size <= 1) return { mesh, faceMaterials };
  const exterior = [...volumes].reduce((a, b) =>
    Math.abs(a[1].volume) > Math.abs(b[1].volume) ? a : b,
  )[0];
  for (const [root, measure] of volumes) {
    if (root === exterior) continue;
    // Both bounds are required: never silently discard a real detached feature.
    if (Math.abs(measure.volume) > 0.001 || Math.abs(measure.volume) / measure.area > 0.00005)
      throw new Error(
        'Painted geometry contains a disconnected region. Adjust the feature placement and generate again.',
      );
  }
  const indices: number[] = [],
    materials: number[] = [];
  for (let face = 0; face < faceMaterials.length; face++) {
    const start = face * 3;
    if (find(mesh.indices[start]) !== exterior) continue;
    indices.push(mesh.indices[start], mesh.indices[start + 1], mesh.indices[start + 2]);
    materials.push(faceMaterials[face]);
  }
  return {
    mesh: { positions: mesh.positions, indices: Uint32Array.from(indices) },
    faceMaterials: Uint8Array.from(materials),
  };
}

/** Encode an unsplit triangle's one-based filament using Bambu/Prusa painting nibbles. */
export function trianglePaintCode(filament: number) {
  if (!Number.isInteger(filament) || filament < 1 || filament > 16)
    throw new Error('Painted faces require a filament number between 1 and 16.');
  return filament < 3
    ? (filament * 4).toString(16).toUpperCase()
    : (filament - 3).toString(16).toUpperCase() + 'C';
}

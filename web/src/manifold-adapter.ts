/** Typed ownership boundary around the lazily loaded Manifold WASM module. */
import type { Manifold, ManifoldToplevel, Mesh as ManifoldMesh } from 'manifold-3d';
import type { Mesh } from './types';

let modulePromise: Promise<ManifoldToplevel> | undefined;

/** Load and initialize Manifold only when printable solid geometry is requested. */
export function loadManifold(progress: (message: string) => void): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    progress('Loading the solid geometry engine…');
    modulePromise = Promise.all([
      import('manifold-3d'),
      import('manifold-3d/manifold.wasm?url'),
    ]).then(async ([module, wasm]) => {
      const initialized = await module.default({ locateFile: () => wasm.default });
      initialized.setup();
      return initialized;
    });
  }
  return modulePromise;
}

/** Construct a checked Manifold solid from an indexed application mesh. */
export function solidFromMesh(module: ManifoldToplevel, meshData: Mesh): Manifold {
  const mesh = new module.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(meshData.positions),
    triVerts: new Uint32Array(meshData.indices),
  });
  mesh.merge();
  const result = new module.Manifold(mesh);
  if (result.status() !== 'NoError') {
    const error = result.status();
    result.delete();
    throw new Error(`Solid geometry is invalid: ${error}`);
  }
  return result;
}

/** Concatenate meshes without welding; Manifold performs the topology merge on import. */
export function combineMeshes(meshes: Mesh[]): Mesh {
  const positionCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0);
  const indexCount = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(positionCount);
  const indices = new Uint32Array(indexCount);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    for (const index of mesh.indices) indices[indexOffset++] = Number(index) + vertexOffset;
    positionOffset += mesh.positions.length;
    vertexOffset += mesh.positions.length / 3;
  }
  return { positions, indices };
}

function exportMesh(mesh: Mesh, tolerance = 0.0001): Mesh {
  const positions: number[] = [];
  const remap: number[] = [];
  const bins = new Map<string, number[]>();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const point = Array.from(mesh.positions.slice(i, i + 3));
    const cell = point.map(value => Math.floor(value / tolerance));
    let match: number | undefined;
    search: for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const ids = bins.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) || [];
          for (const id of ids)
            if (
              point.every((value, axis) => Math.abs(value - positions[id * 3 + axis]) <= tolerance)
            ) {
              match = id;
              break search;
            }
        }
    if (match === undefined) {
      match = positions.length / 3;
      positions.push(...point);
      const key = cell.join(',');
      bins.set(key, [...(bins.get(key) || []), match]);
    }
    remap.push(match);
  }
  const faces: (number[] | null)[] = [];
  const pending = new Map<string, number>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const face = [
      remap[Number(mesh.indices[i])],
      remap[Number(mesh.indices[i + 1])],
      remap[Number(mesh.indices[i + 2])],
    ];
    if (new Set(face).size < 3) continue;
    const key = [...face].sort((a, b) => a - b).join(',');
    const previous = pending.get(key);
    if (previous !== undefined) {
      const other = faces[previous]!;
      const offset = other.indexOf(face[0]);
      if (face[1] === other[(offset + 2) % 3]) {
        faces[previous] = null;
        pending.delete(key);
        continue;
      }
    }
    pending.set(key, faces.length);
    faces.push(face);
  }
  return { positions, indices: faces.filter((face): face is number[] => face !== null).flat() };
}

/** Assert that a mesh is finite, nondegenerate, closed, and consistently oriented. */
export function validateMesh(mesh: Mesh) {
  const canonical = new Map<string, number>();
  const remap: number[] = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const point = [
      Number(mesh.positions[index]),
      Number(mesh.positions[index + 1]),
      Number(mesh.positions[index + 2]),
    ];
    if (point.some(value => !Number.isFinite(value))) throw new Error('Non-finite mesh coordinate');
    const key = point.map(value => value.toFixed(8)).join(',');
    if (!canonical.has(key)) canonical.set(key, canonical.size);
    remap.push(canonical.get(key)!);
  }
  const edges = new Map<string, { count: number; sum: number }>();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [
      remap[Number(mesh.indices[index])],
      remap[Number(mesh.indices[index + 1])],
      remap[Number(mesh.indices[index + 2])],
    ];
    if (new Set(triangle).size !== 3) throw new Error('Export contains degenerate triangles');
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const from = triangle[edgeIndex];
      const to = triangle[(edgeIndex + 1) % 3];
      const key = `${Math.min(from, to)},${Math.max(from, to)}`;
      const edge = edges.get(key) || { count: 0, sum: 0 };
      edge.count++;
      edge.sum += from < to ? 1 : -1;
      edges.set(key, edge);
    }
  }
  const invalid = [...edges.entries()].filter(([, edge]) => edge.count !== 2 || edge.sum !== 0);
  if (invalid.length)
    throw new Error(
      `Generated mesh is not watertight (${invalid.length} of ${edges.size} edges; ${invalid
        .slice(0, 5)
        .map(([key, edge]) => `${key}=${edge.count}/${edge.sum}`)
        .join(', ')})`,
    );
}

function resolveMergeVectors(raw: ManifoldMesh): Mesh {
  const numProp = Number(raw.numProp) || 3;
  const numVert = raw.vertProperties.length / numProp;
  const positions = new Array<number>(numVert * 3);
  const parent = Array.from({ length: numVert }, (_, index) => index);
  for (let index = 0; index < numVert; index++)
    for (let axis = 0; axis < 3; axis++)
      positions[index * 3 + axis] = raw.vertProperties[index * numProp + axis];
  const from = raw.mergeFromVert;
  const to = raw.mergeToVert;
  if (from && to)
    for (let index = 0; index < Math.min(from.length, to.length); index++)
      if (from[index] < numVert && to[index] < numVert) parent[from[index]] = to[index];
  const root = (index: number) => {
    let next = index;
    let guard = 0;
    while (parent[next] !== next && guard++ < numVert) next = parent[next];
    let current = index;
    while (parent[current] !== current) {
      const previous = parent[current];
      parent[current] = next;
      current = previous;
    }
    return next;
  };
  return {
    positions,
    indices: Array.from(raw.triVerts, index => root(Number(index))),
  };
}

/** Export a Manifold solid, resolving merge vectors and trying bounded simplification/weld tolerances. */
export function validatedMesh(input: Manifold, label: string): Mesh {
  let last: unknown;
  for (const tolerance of [0, 0.0001, 0.001, 0.005]) {
    const clean = tolerance ? input.simplify(tolerance) : input;
    try {
      const source = resolveMergeVectors(clean.getMesh());
      for (const weldTolerance of [0.0000001, 0.000001, 0.00001, 0.0001]) {
        try {
          const mesh = exportMesh(source, weldTolerance);
          validateMesh(mesh);
          return mesh;
        } catch (error) {
          last = error;
        }
      }
      throw last;
    } catch (error) {
      last = error;
    } finally {
      if (clean !== input) clean.delete();
    }
  }
  throw new Error(`${label}: ${String(last)}`);
}

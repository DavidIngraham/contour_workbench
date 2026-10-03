/** Typed ownership boundary around the lazily loaded Manifold WASM module. */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
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

/** Assert that a mesh is finite, indexed correctly, closed, and consistently oriented. */
export function validateMesh(mesh: Mesh) {
  if (mesh.positions.length % 3 || mesh.indices.length % 3)
    throw new Error('Invalid mesh array cardinality');
  const vertexCount = mesh.positions.length / 3;
  for (const value of mesh.positions)
    if (!Number.isFinite(Number(value))) throw new Error('Non-finite mesh coordinate');

  const edges = new Map<string, { count: number; sum: number }>();
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [
      Number(mesh.indices[index]),
      Number(mesh.indices[index + 1]),
      Number(mesh.indices[index + 2]),
    ];
    if (triangle.some(vertex => !Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount))
      throw new Error('Export contains an invalid vertex index');
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
  if (!edges.size || invalid.length)
    throw new Error(
      `Generated mesh is not watertight (${invalid.length} of ${edges.size} edges; ${invalid
        .slice(0, 5)
        .map(([key, edge]) => `${key}=${edge.count}/${edge.sum}`)
        .join(', ')})`,
    );
}

/** Topological fields used from a Manifold MeshGL export. */
export interface ManifoldMeshTopology {
  numProp: number;
  vertProperties: ArrayLike<number>;
  triVerts: ArrayLike<number>;
  mergeFromVert?: ArrayLike<number>;
  mergeToVert?: ArrayLike<number>;
}

/**
 * Resolve Manifold's merge-vector union relation and discard unused property vertices.
 *
 * Coordinate proximity is deliberately ignored: distinct topology may occupy nearly
 * identical positions, and welding it can create edges shared by more than two faces.
 */
export function compactManifoldMesh(raw: ManifoldMeshTopology): Mesh {
  const numProp = Number(raw.numProp) || 3;
  const numVert = raw.vertProperties.length / numProp;
  const parent = Array.from({ length: numVert }, (_, index) => index);
  const root = (index: number) => {
    let current = index;
    while (parent[current] !== current) current = parent[current];
    while (parent[index] !== index) {
      const previous = parent[index];
      parent[index] = current;
      index = previous;
    }
    return current;
  };
  const unite = (first: number, second: number) => {
    const firstRoot = root(first);
    const secondRoot = root(second);
    if (firstRoot !== secondRoot) parent[firstRoot] = secondRoot;
  };

  const from = raw.mergeFromVert;
  const to = raw.mergeToVert;
  if (from && to)
    for (let index = 0; index < Math.min(from.length, to.length); index++) {
      const first = Number(from[index]);
      const second = Number(to[index]);
      if (
        Number.isInteger(first) &&
        Number.isInteger(second) &&
        first >= 0 &&
        second >= 0 &&
        first < numVert &&
        second < numVert
      )
        unite(first, second);
    }

  const positions: number[] = [];
  const compact = new Map<number, number>();
  const indices = Array.from(raw.triVerts, sourceIndex => {
    const source = root(Number(sourceIndex));
    let target = compact.get(source);
    if (target === undefined) {
      target = compact.size;
      compact.set(source, target);
      for (let axis = 0; axis < 3; axis++)
        positions.push(Number(raw.vertProperties[source * numProp + axis]));
    }
    return target;
  });
  return { positions, indices };
}

/** Export a Manifold solid, preserving supplied topology before attempting geometric repair. */
export function validatedMesh(input: Manifold, label: string): Mesh {
  let last: unknown;
  for (const tolerance of [0, 0.0001, 0.001, 0.005]) {
    const clean = tolerance ? input.simplify(tolerance) : input;
    try {
      const source = compactManifoldMesh(clean.getMesh());
      try {
        validateMesh(source);
        return source;
      } catch (error) {
        last = error;
      }
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

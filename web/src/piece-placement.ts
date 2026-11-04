/** Assembly orientation for browser-generated bottom and side annotation inserts. */
import type { Mesh, Piece } from './types';

/** Bake only the assembly rotation; callers still apply the piece's origin translation. */
export function assembledPieceMesh(piece: Piece): Mesh {
  const b = piece.assembly_basis;
  if (!b) return piece.mesh;
  if (b.length !== 9 || !b.every(Number.isFinite))
    throw new Error('Invalid insert assembly orientation.');
  const positions: number[] = [];
  for (let i = 0; i < piece.mesh.positions.length; i += 3) {
    const [x, y, z] = Array.from(piece.mesh.positions.slice(i, i + 3));
    for (let axis = 0; axis < 3; axis++)
      positions.push(b[axis] * x + b[axis + 3] * y + b[axis + 6] * z);
  }
  return { positions, indices: piece.mesh.indices };
}

import { describe, expect, it } from 'vitest';
import { compactManifoldMesh, validateMesh } from '../src/manifold-adapter';

const tetrahedron = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  indices: [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3],
};

describe('Manifold mesh topology', () => {
  it('resolves chained merge vectors and compacts property seams', () => {
    const mesh = compactManifoldMesh({
      numProp: 4,
      vertProperties: new Float32Array([
        0, 0, 0, 10, 1, 0, 0, 11, 0, 1, 0, 12, 0, 0, 0, 13, 0, 1, 0, 14, 1, 1, 0, 15, 0, 0, 0, 16,
      ]),
      triVerts: new Uint32Array([0, 1, 2, 3, 4, 5]),
      mergeFromVert: new Uint32Array([3, 6, 4]),
      mergeToVert: new Uint32Array([6, 0, 2]),
    });

    expect(mesh.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    expect(mesh.indices).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('keeps coincident closed shells topologically separate', () => {
    const offsetIndices = tetrahedron.indices.map(index => index + 4);
    expect(() =>
      validateMesh({
        positions: [...tetrahedron.positions, ...tetrahedron.positions],
        indices: [...tetrahedron.indices, ...offsetIndices],
      }),
    ).not.toThrow();
  });

  it('rejects invalid indices and empty exports', () => {
    expect(() => validateMesh({ positions: tetrahedron.positions, indices: [0, 2, 4] })).toThrow(
      'invalid vertex index',
    );
    expect(() => validateMesh({ positions: [], indices: [] })).toThrow('not watertight');
  });
});

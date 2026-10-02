import { describe, expect, it } from 'vitest';
import { decodeMesh, overlayFeatureId, validatePresetLinks } from '../src/presets';
import type { Overlay, Project } from '../src/types';

describe('static preset bundles', () => {
  it('decodes packed float positions and triangle indices', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      indices = new Uint32Array([0, 1, 2]),
      bytes = new Uint8Array(8 + positions.byteLength + indices.byteLength),
      view = new DataView(bytes.buffer);
    view.setUint32(0, positions.length, true);
    view.setUint32(4, indices.length, true);
    bytes.set(new Uint8Array(positions.buffer), 8);
    bytes.set(new Uint8Array(indices.buffer), 8 + positions.byteLength);
    const mesh = decodeMesh(bytes);
    expect(Array.from(mesh.positions)).toEqual(Array.from(positions));
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });
  it('maps every overlay segment back to its feature-tree id', () => {
    const project = {
      features: [
        { id: 'trail:1', name: 'Trail', class: 'trail', lines: [], enabled: true, tags: {} },
      ],
    } as unknown as Project;
    const overlay = {
      id: 'trail:1#0',
      class: 'trail',
      treatment: 'insert',
      mesh: { positions: [], indices: [] },
    } as Overlay;
    expect(overlayFeatureId(overlay.id)).toBe('trail:1');
    expect(() => validatePresetLinks(project, [overlay])).not.toThrow();
    expect(() => validatePresetLinks(project, [{ ...overlay, id: 'missing#0' }])).toThrow(
      /unknown feature/,
    );
  });
});

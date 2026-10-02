import { it, expect } from 'vitest';
import { topoProvider } from '../src/topo';
it('uses USGS for Post Canyon and global topo internationally', () => {
  expect(topoProvider([-121.7, 45.6, -121.5, 45.8])).toBe('usgs');
  expect(topoProvider([7, 45, 7.1, 45.1])).toBe('global');
  expect(topoProvider([-157.9, 21.2, -157.8, 21.3])).toBe('usgs');
});

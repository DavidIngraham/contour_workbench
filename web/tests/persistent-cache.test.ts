import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMemoryCache,
  persistentCacheKey,
  readPersistentCache,
  writePersistentCache,
} from '../src/persistent-cache';

describe('persistent response cache', () => {
  beforeEach(() => clearMemoryCache());

  it('creates stable compact keys', () => {
    expect(persistentCacheKey('osm', 'query')).toBe(persistentCacheKey('osm', 'query'));
    expect(persistentCacheKey('osm', 'query')).not.toBe(persistentCacheKey('osm', 'other'));
    expect(persistentCacheKey('osm', 'query')).not.toContain('query');
  });

  it('returns a clone so callers cannot mutate cached terrain state', async () => {
    await writePersistentCache('terrain', { elevations: [1, 2, 3] });
    const first = await readPersistentCache<{ elevations: number[] }>('terrain', 1000);
    first!.elevations[0] = 99;
    const second = await readPersistentCache<{ elevations: number[] }>('terrain', 1000);
    expect(second).toEqual({ elevations: [1, 2, 3] });
  });
});

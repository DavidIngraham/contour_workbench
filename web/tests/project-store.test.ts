import { beforeEach, describe, expect, it } from 'vitest';
import { defaults, type Project } from '../src/types';
import {
  clearLocalProjectMemory,
  deleteLocalProject,
  duplicateLocalProject,
  listLocalProjects,
  loadLocalProject,
  newLocalProjectIdentity,
  readProjectThumbnail,
  renameLocalProject,
  saveLocalProject,
  writeProjectThumbnail,
} from '../src/project-store';

const sampleProject = (): Project => ({
  schema_version: 2,
  name: 'Local mountain',
  grid: {
    bounds: [-121.7, 45.2, -121.6, 45.3],
    width: 2,
    height: 2,
    elevations: [100.125, 110.25, 120.5, 130.75],
  },
  source: {
    product: 'test',
    name: 'Test terrain',
    retrieved: '2026-10-03T00:00:00Z',
    attribution: 'Test',
  },
  features: [],
  settings: {
    ...structuredClone(defaults),
    boundary: [
      [-121.7, 45.2],
      [-121.6, 45.2],
      [-121.6, 45.3],
      [-121.7, 45.3],
    ],
  },
});

describe('local project sessions', () => {
  beforeEach(() => clearLocalProjectMemory());

  it('round-trips project state while listing only lightweight metadata', async () => {
    const identity = newLocalProjectIdentity('post-canyon'),
      project = sampleProject();
    expect(await saveLocalProject(project, { ...identity, write_terrain: true })).toBe(false);
    const summaries = await listLocalProjects();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: identity.id,
      name: 'Local mountain',
      source_name: 'Test terrain',
      origin_preset_id: 'post-canyon',
      feature_count: 0,
    });
    const loaded = await loadLocalProject(identity.id);
    expect(loaded?.project.grid.elevations).toEqual(project.grid.elevations);
    expect(loaded?.project.settings.boundary).toEqual(project.settings.boundary);
  });

  it('renames, duplicates, thumbnails, and deletes projects independently', async () => {
    const identity = newLocalProjectIdentity(),
      project = sampleProject();
    await saveLocalProject(project, { ...identity, write_terrain: true });
    const thumbnail = new Blob(['image'], { type: 'image/webp' });
    await writeProjectThumbnail(identity.id, thumbnail);
    await renameLocalProject(identity.id, 'Renamed mountain');
    const copyId = await duplicateLocalProject(identity.id);
    expect((await loadLocalProject(identity.id))?.project.name).toBe('Renamed mountain');
    expect((await loadLocalProject(copyId))?.project.name).toBe('Renamed mountain copy');
    expect((await readProjectThumbnail(copyId))?.size).toBe(thumbnail.size);
    await deleteLocalProject(identity.id);
    expect(await loadLocalProject(identity.id)).toBeUndefined();
    expect(await listLocalProjects()).toHaveLength(1);
  });
});

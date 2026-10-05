import { describe, expect, it } from 'vitest';
import { defaultMaterialGroups, projectMaterialGroups } from '../src/types';

describe('project material groups', () => {
  it('provides one color and extruder assignment for every feature class', () => {
    const groups = projectMaterialGroups({});

    expect(groups).toEqual(defaultMaterialGroups);
    expect(groups.map(group => group.id)).toEqual([
      'terrain',
      'trail',
      'road',
      'stream',
      'water',
      'glacier',
      'ski_run',
      'ski_lift',
    ]);
  });

  it('migrates an old global feature material to every feature class', () => {
    const groups = projectMaterialGroups({
      materials: [
        { id: 'terrain', name: 'Ground', color: '#112233', extruder: 1 },
        { id: 'features', name: 'Features', color: '#abcdef', extruder: 3 },
      ],
    });

    expect(groups[0]).toMatchObject({ name: 'Ground', color: '#112233', extruder: 1 });
    expect(groups.slice(1).every(group => group.color === '#abcdef' && group.extruder === 3)).toBe(
      true,
    );
  });

  it('lets a class-specific assignment override the legacy fallback', () => {
    const groups = projectMaterialGroups({
      materials: [
        { id: 'features', name: 'Features', color: '#abcdef', extruder: 3 },
        { id: 'water', name: 'Water', color: '#0055ff', extruder: 4 },
      ],
    });

    expect(groups.find(group => group.id === 'trail')).toMatchObject({
      color: '#abcdef',
      extruder: 3,
    });
    expect(groups.find(group => group.id === 'water')).toMatchObject({
      color: '#0055ff',
      extruder: 4,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { filamentPlan, displayMaterials } from '../src/filaments';
import { defaults, type Project } from '../src/types';

describe('physical filament assignments', () => {
  const project: Pick<Project, 'materials' | 'settings'> = {
    settings: { ...defaults, manufacturing_mode: 'multicolor' },
    materials: [
      { id: 'terrain', name: 'Base', color: '#123456', extruder: 1 },
      { id: 'trail', name: 'Trail', color: '#ff0000', extruder: 2 },
      { id: 'water', name: 'Water', color: '#0000ff', extruder: 2 },
    ],
  };
  it('flags shared-slot conflicts and resolves the same palette for preview and export', () => {
    const plan = filamentPlan(project);
    expect(plan.slots.get(2)?.conflict).toBe(true);
    expect(plan.groups.find(g => g.id === 'water')?.color).toBe('#FF0000');
    expect(displayMaterials(project)).toEqual(plan.groups);
    expect(project.materials?.find(g => g.id === 'water')?.color).toBe('#0000ff');
    expect(
      displayMaterials({ ...project, settings: defaults }).find(g => g.id === 'water')?.color,
    ).toBe('#0000ff');
  });
  it.each([0, 17, 1.5, NaN])('rejects invalid filament slot %s', extruder => {
    expect(() =>
      filamentPlan({ materials: [{ id: 'terrain', name: 'Terrain', color: '#abcdef', extruder }] }),
    ).toThrow('slot');
  });
});

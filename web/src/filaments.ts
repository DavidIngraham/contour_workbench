import { projectMaterialGroups, type Project } from './types';

/** Resolve one deterministic color per physical filament slot, including legacy conflicts. */
export function filamentPlan(project: Pick<Project, 'materials'>) {
  const groups = projectMaterialGroups(project);
  const slots = new Map<number, { color: string; names: string[]; conflict: boolean }>();
  for (const group of groups) {
    if (!Number.isInteger(group.extruder) || group.extruder < 1 || group.extruder > 16)
      throw new Error(`${group.name}: choose a filament slot from 1 to 16.`);
    if (!/^#[0-9a-f]{6}$/i.test(group.color))
      throw new Error(`${group.name}: choose a valid color.`);
    const color = group.color.toUpperCase();
    const slot = slots.get(group.extruder);
    if (slot) {
      slot.names.push(group.name);
      slot.conflict ||= slot.color !== color;
    } else slots.set(group.extruder, { color, names: [group.name], conflict: false });
  }
  return {
    slots,
    groups: groups.map(group => ({ ...group, color: slots.get(group.extruder)!.color })),
  };
}

/** Use physical filament colors for print-together previews while preserving separate-part colors. */
export function displayMaterials(
  project: Pick<Project, 'materials'> & Partial<Pick<Project, 'settings'>>,
) {
  return project.settings?.manufacturing_mode === 'multicolor'
    ? filamentPlan(project).groups
    : projectMaterialGroups(project);
}

/** Native OrcaSlicer profiles pinned to 2.4.2; geometry settings remain slicer independent. */
import baselines from './orca-profiles.json';
import { bambuPrinters } from './bambu-printers';
import type { PrusaNozzleType } from './prusa-printers';
import { orcaPrinter, type OrcaPrinterId, type OrcaMaterialMode } from './orca-printer-catalog';
export {
  orcaPrinters,
  orcaPrinter,
  type OrcaPrinterId,
  type OrcaMaterialMode,
} from './orca-printer-catalog';
type Config = Record<string, string | string[]>;
interface Profile {
  machine: Config;
  process: Config;
  filament: Config;
  printer_settings_id: string;
  print_settings_id: string;
  filament_settings_id: string;
  filament_id: string;
}

/** Resolve a complete stock machine/process/PLA baseline, never another nozzle's profile. */
export function orcaProfile(
  id: OrcaPrinterId = 'p1s',
  nozzleMm = 0.4,
  nozzleType: PrusaNozzleType = 'high-flow',
): Profile {
  orcaPrinter(id);
  if (!['standard', 'high-flow'].includes(nozzleType))
    throw new Error('Choose a supported nozzle type.');
  const highFlow =
    orcaPrinter(id).family === 'prusa' && nozzleType === 'high-flow' && nozzleMm >= 0.4;
  const key = `${id}/${highFlow ? 'HF' : ''}${nozzleMm}`;
  const profile = (baselines.profiles as Record<string, Profile>)[key];
  if (!profile)
    throw new Error(
      `No stock OrcaSlicer ${orcaPrinter(id).name} ${highFlow ? 'high-flow ' : ''}${nozzleMm} mm nozzle profile is available.`,
    );
  return structuredClone(profile);
}

/** Derive packing bounds from the same machine configuration embedded in the project. */
export function orcaPackingPrinter(id: OrcaPrinterId, profile: Profile, mode: OrcaMaterialMode) {
  const supported = orcaPrinter(id);
  if (!['manual', 'automatic'].includes(mode))
    throw new Error('Choose a supported filament setup.');
  if (mode === 'automatic' && !supported.automatic)
    throw new Error(
      'This OrcaSlicer Prusa profile supports manual changes between plates. Use PrusaSlicer for MMU3.',
    );
  const machine = profile.machine;
  const area = (machine.printable_area as string[]).map(point => point.split('x').map(Number));
  const widthMm = Math.max(...area.map(point => point[0]));
  const depthMm = Math.max(...area.map(point => point[1]));
  const bambu = id in bambuPrinters ? bambuPrinters[id as keyof typeof bambuPrinters] : undefined;
  return {
    name: supported.name,
    widthMm,
    depthMm,
    heightMm: Number(machine.printable_height),
    clearanceMm: Number(machine.extruder_clearance_max_radius ?? machine.extruder_clearance_radius),
    rodHeightMm: Number(machine.extruder_clearance_height_to_rod),
    // Full clearance for all objects avoids relying on Bambu's low-nozzle tier.
    nozzleHeightMm: 0,
    keepouts: bambu
      ? [
          ...(bambu.excludedBedMm[0] ? [[0, 0, ...bambu.excludedBedMm] as const] : []),
          bambu.purgeKeepoutMm,
        ]
      : [],
    maxPlates: 36,
    slicer: 'orca' as const,
    singleFilament: mode === 'manual',
  };
}

/** Build Orca settings with physical filament vectors and intentional process overrides. */
export function orcaProjectSettings(
  profile: Profile,
  colors: string[],
  separate: boolean,
  processOverrides: Config = {},
) {
  const filament = Object.fromEntries(
    Object.entries(profile.filament).map(([key, value]) => [
      key,
      Array.isArray(value) && value.length === 1 ? colors.map(() => value[0]) : value,
    ]),
  );
  const overrides = {
    ...processOverrides,
    print_sequence: separate ? 'by object' : 'by layer',
    brim_type: separate ? 'outer_only' : 'no_brim',
    brim_width: separate ? '3' : '0',
    skirt_loops: '0',
    enable_prime_tower: separate || colors.length < 2 ? '0' : '1',
    // Type 1 is Orca's recommended tower for Bambu filament cutters. Explicit
    // rectangular walls keep the tower inside the reserved footprint.
    wipe_tower_type: 'type1',
    wipe_tower_wall_type: 'rectangle',
    prime_tower_brim_width: '3',
    ...(separate ? { elefant_foot_compensation: '0' } : {}),
  };
  return {
    ...profile.process,
    ...profile.machine,
    ...filament,
    ...overrides,
    printer_settings_id: profile.printer_settings_id,
    print_settings_id: profile.print_settings_id,
    filament_settings_id: colors.map(() => profile.filament_settings_id),
    filament_ids: colors.map(() => profile.filament_id),
    filament_colour: colors,
    curr_bed_type: 'Textured PEI Plate',
    inherits_group: ['', ...colors.map(() => ''), ''],
    // Complete resolved baselines are embedded; no installed user presets are required.
    different_settings_to_system: [
      Object.keys({ ...profile.process, ...overrides }).join(';'),
      ...colors.map(() => Object.keys({ ...filament, filament_colour: colors }).join(';')),
      Object.keys(profile.machine).join(';'),
    ],
  };
}

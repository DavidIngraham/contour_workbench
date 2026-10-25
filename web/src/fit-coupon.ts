/** Independent coupon controls, validation, and the wording engraved on the print. */
import { calibrationClearances, fitProfile } from './insert-fit';
import type { Settings } from './types';

/** Repeated terrain relief, large enough to exercise terrain-conforming inserts. */
export const couponReliefMm = 4;

export interface FitCouponOptions {
  clearances_mm: number[];
  /** Solid material beneath the pockets; older requests retain the 1 mm floor. */
  floor_thickness_mm?: number;
}

export const couponFields = [
  ['insert_depth_mm', 'Coupon / insert thickness', 'mm', 1.5, 20, 0.01],
  ['nozzle_diameter_mm', 'Nozzle diameter', 'mm', 0.2, 0.8, 0.01],
  ['path_width_mm', 'Path width', 'mm', 0.45, 3, 0.01],
  ['insert_elephant_foot_relief_mm', 'Elephant-foot relief · each side', 'mm', 0, 1, 0.01],
  ['insert_elephant_foot_height_mm', 'Elephant-foot taper height', 'mm', 0, 3, 0.01],
  ['insert_draft_angle_deg', 'Insert draft angle', '°', 0, 10, 0.01],
  ['insert_draft_height_mm', 'Draft taper height · maximum', 'mm', 0, 5, 0.01],
] as const;

/** Starting values preserve the project's selected fit without duplicate pockets. */
export function defaultCouponOptions(settings: Settings): FitCouponOptions {
  const values = calibrationClearances(settings);
  return {
    clearances_mm: values.map((value, i) => Math.max(value, values[0] + i * 0.05)),
    floor_thickness_mm: 1,
  };
}

/** Reject ambiguous labels and taper values that the normal fit planner would clamp. */
export function validateCoupon(settings: Settings, options: FitCouponOptions) {
  const floor = options.floor_thickness_mm ?? 1;
  if (
    !Number.isFinite(floor) ||
    floor < 1 ||
    floor > 20 ||
    Math.abs(floor * 100 - Math.round(floor * 100)) > 1e-6
  )
    throw new Error(
      'Coupon base thickness must be between 1 and 20 mm, with up to two decimal places.',
    );
  for (const [key, label, unit, min, max] of couponFields) {
    const value = settings[key];
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label} must be between ${min} and ${max} ${unit}.`);
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)
      throw new Error(`${label} supports two decimal places, matching the printed label.`);
  }
  const values = options.clearances_mm;
  if (
    values.length !== 4 ||
    values.some(
      (v, i) =>
        !Number.isFinite(v) ||
        v < 0 ||
        v > 1 ||
        Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ||
        (i > 0 && v <= values[i - 1]),
    )
  )
    throw new Error(
      'Enter four increasing clearances from 0 to 1 mm, with up to two decimal places.',
    );
  if (settings.path_width_mm < settings.nozzle_diameter_mm * 2.25)
    throw new Error(
      'Increase path width to at least 2.25 × the nozzle diameter for two extrusion lines.',
    );
  const profile = fitProfile(settings, 'trail', settings.insert_depth_mm);
  const requestedDraft =
    Math.tan((settings.insert_draft_angle_deg * Math.PI) / 180) * profile.draftHeightMm;
  if (
    Math.abs(profile.footReliefMm - settings.insert_elephant_foot_relief_mm) > 1e-6 ||
    Math.abs(profile.draftBottomInsetMm - requestedDraft) > 1e-6
  )
    throw new Error(
      'This taper leaves too little material. Increase path width, or reduce elephant-foot relief or draft angle.',
    );
  if (settings.insert_elephant_foot_relief_mm > 0 && settings.insert_elephant_foot_height_mm === 0)
    throw new Error('Set a positive taper height when using elephant-foot relief.');
  if (settings.insert_draft_angle_deg > 0 && settings.insert_draft_height_mm === 0)
    throw new Error('Set a positive draft taper height when using a draft angle.');
  if (profile.footHeightMm < settings.insert_elephant_foot_height_mm - 1e-6)
    throw new Error('Reduce elephant-foot taper height to leave room for the insert seating band.');
}

/** Scale pocket spacing and lettering for wider paths and larger nozzles. */
export function couponLayout(settings: Settings, options: FitCouponOptions) {
  const textScale = Math.max(1, settings.nozzle_diameter_mm / 0.4);
  const pathScale = Math.max(
    textScale,
    (settings.path_width_mm + 2 * Math.max(...options.clearances_mm) + 0.6) / 2.4,
  );
  return {
    pathScale,
    textScale,
    widthMm: 100 * pathScale,
    tileWidthMm: 25 * pathScale,
    pocketCentersMm: [12.5, 37.5, 62.5, 87.5].map(x => x * pathScale),
    pocketCenterYMm: 20 * pathScale,
    terrainDepthMm: 28 * pathScale,
    depthMm: 28 * pathScale,
    engravingDepthMm: 0.4,
    floorMm: options.floor_thickness_mm ?? 1,
    surfaceMm: settings.insert_depth_mm + (options.floor_thickness_mm ?? 1),
    reliefMm: couponReliefMm,
    totalHeightMm: settings.insert_depth_mm + (options.floor_thickness_mm ?? 1) + couponReliefMm,
  };
}

/** Labels use the same validated values as the generated geometry. */
export function couponLabels(settings: Settings, options: FitCouponOptions) {
  const n = (v: number) => v.toFixed(2);
  const profile = fitProfile(settings, 'trail', settings.insert_depth_mm);
  return {
    pockets: options.clearances_mm.map(v => `${n(v)} MM`),
    settings: [
      `NOZZLE ${n(settings.nozzle_diameter_mm)} MM  PATH ${n(settings.path_width_mm)} MM`,
      `MIN INSERT ${n(settings.insert_depth_mm)} MM`,
      `FOOT/SIDE ${n(settings.insert_elephant_foot_relief_mm)} MM  H ${n(settings.insert_elephant_foot_height_mm)} MM`,
      `DRAFT ${n(settings.insert_draft_angle_deg)} DEG  H ${n(profile.draftHeightMm)} MM`,
      `FLOOR ${n(options.floor_thickness_mm ?? 1)} MM  RELIEF ${n(couponReliefMm)} MM`,
      'POCKET CLEARANCE PER SIDE',
    ],
  };
}

/** Coupon-only form: edits never change the loaded project's Print setup. */
export function couponForm() {
  return `<p class="help">Each pocket repeats the same Mt. Hood Meadows terrain patch with 4 mm of relief. All four inserts follow that surface and remain interchangeable. Coupon / insert thickness sets their minimum thickness and grows the base and inserts together. The solid floor below the pockets stays fixed; extra height extends the straight section above the taper. No need to increase the floor too.</p><div class="coupon-fields">${couponFields
    .map(
      ([key, label, unit, min, max, step]) =>
        `<label for="coupon-${key}">${label} (${unit})<input id="coupon-${key}" type="number" required min="${min}" max="${max}" step="${step}"/></label>`,
    )
    .join('')}</div>
    <p class="help">Draft angle applies only over its taper height, not the overall insert thickness. Shallow inserts shorten that height to retain a straight seating band. H in each engraved taper row records that taper's height.</p>
    <details><summary>Solid floor beneath pockets · advanced</summary><label for="coupon-floor-thickness">Floor thickness (mm)<input id="coupon-floor-thickness" type="number" required min="1" max="20" step="0.01" value="1" aria-describedby="coupon-floor-help"/></label>
    <p class="help" id="coupon-floor-help">Only changes material beneath the pockets, not insert thickness. Underside lettering removes 0.4 mm locally. Keep 1 mm unless you need a stronger floor. Recorded as FLOOR underneath.</p></details>
    <fieldset class="coupon-clearances"><legend>Pocket clearance · each side (mm)</legend><div class="coupon-fields">${[1, 2, 3, 4].map(n => `<label for="coupon-clearance-${n}">Pocket ${n}<input id="coupon-clearance-${n}" type="number" required min="0" max="1" step="0.01"/></label>`).join('')}</div></fieldset>
    <p class="help">Choose four increasing clearances. All four inserts have the same dimensions; try any insert in each pocket. Copy the smallest clearance that seats without force into Print setup → Pocket clearance · each side.</p>
    <details open><summary>Labels engraved underneath</summary><p class="help">Flip over the long edge to read the settings. Each clearance lines up with its pocket across the width. Print terrain-side up, with the recessed writing against the bed.</p><div id="coupon-label-preview" class="coupon-label-preview"></div></details>
    <p class="help" id="coupon-size"></p><p id="coupon-error" role="alert"></p>`;
}

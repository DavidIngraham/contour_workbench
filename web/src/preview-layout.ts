/** Lightweight geographic layout used before elevation geometry is available. */
import { normalizeSettings, type Bounds, type Layout, type Project, type Settings } from './types';
import { modelXY } from './layout-transform';
import { polygonBounds } from './polygon';

const metersPerDegree = 111319.490793;

/** Preserve saved model orientation when opening projects made before arbitrary rotation. */
export function projectLayoutSettings(
  project: Pick<Project, 'settings' | 'grid' | 'annotations'>,
): Settings {
  const settings = normalizeSettings(project.settings);
  if (project.settings?.bed_rotation_deg === undefined) {
    const bounds = settings.boundary.length
      ? polygonBounds(settings.boundary)
      : project.grid.bounds;
    settings.bed_rotation_deg = previewLayout(bounds, settings).rotated ? 90 : 0;
  }
  return settings;
}

/** Approximate loading layout; also reconstructs legacy 0°/90° project orientation. */
export function previewLayout(
  bounds: Bounds,
  settings: Pick<Settings, 'max_print_size_mm' | 'height_factor' | 'base_height_mm'>,
): Layout {
  const latitude = ((bounds[1] + bounds[3]) * Math.PI) / 360,
    groundWidth = (bounds[2] - bounds[0]) * metersPerDegree * Math.cos(latitude),
    groundDepth = (bounds[3] - bounds[1]) * metersPerDegree,
    direct = Math.min(
      settings.max_print_size_mm[0] / groundWidth,
      settings.max_print_size_mm[1] / groundDepth,
    ),
    rotatedScale = Math.min(
      settings.max_print_size_mm[0] / groundDepth,
      settings.max_print_size_mm[1] / groundWidth,
    ),
    rotated = rotatedScale > direct,
    scale = Math.max(direct, rotatedScale);
  if (
    ![groundWidth, groundDepth, scale].every(Number.isFinite) ||
    groundWidth <= 0 ||
    groundDepth <= 0 ||
    scale <= 0
  )
    throw new Error('The selected area cannot be fitted to the print bed.');
  return {
    bounds: [...bounds],
    width: (rotated ? groundDepth : groundWidth) * scale,
    depth: (rotated ? groundWidth : groundDepth) * scale,
    scale,
    rotated,
    minimum: 0,
    height_factor: settings.height_factor,
    base_height: settings.base_height_mm,
  };
}

/** Project a geographic polygon into the model-local XY coordinates used by the viewer. */
export function previewBoundary(layout: Layout, points: [number, number][]): [number, number][] {
  return points.map(point => modelXY(layout, point));
}

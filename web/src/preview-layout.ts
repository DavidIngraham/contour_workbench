/** Lightweight geographic layout used before elevation geometry is available. */
import type { Bounds, Layout, Settings } from './types';

const metersPerDegree = 111319.490793;

/** Match Rust's print-bed orientation and scale using geographic bounds alone. */
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
  return points.map(([longitude, latitude]) => {
    const u = (longitude - layout.bounds[0]) / (layout.bounds[2] - layout.bounds[0]),
      v = (latitude - layout.bounds[1]) / (layout.bounds[3] - layout.bounds[1]);
    return layout.rotated
      ? [(1 - v) * layout.width, u * layout.depth]
      : [u * layout.width, v * layout.depth];
  });
}

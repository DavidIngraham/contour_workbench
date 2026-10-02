/** Elevation-source selection based on geographic area and browser sample limits. */
import type { Bounds, Product } from './types';
// Estimate the rectangular raster allocation, including its border samples.
/** Estimate raster samples, including the source-border halo. */
export function sourceSampleCount(bounds: Bounds, spacingM: number) {
  const degrees = spacingM / 30 / 3600;
  return (
    (Math.ceil((bounds[2] - bounds[0]) / degrees) + 3) *
    (Math.ceil((bounds[3] - bounds[1]) / degrees) + 3)
  );
}
/** Select 10 m, 30 m, or 90 m elevation while targeting at most one million samples. */
export function automaticProduct(bounds: Bounds): Product {
  const [w, s, e, n] = bounds;
  const us =
    (w >= -125 && e <= -66 && s >= 24 && n <= 50) ||
    (w >= -180 && e <= -129 && s >= 51 && n <= 72) ||
    (w >= -161 && e <= -154 && s >= 18 && n <= 23) ||
    (w >= -68 && e <= -65 && s >= 17 && n <= 19);
  if (us && sourceSampleCount(bounds, 10) <= 1_000_000) return 'usgs_3dep_10m';
  if (sourceSampleCount(bounds, 30) <= 1_000_000) return us ? 'usgs_3dep_30m' : 'copernicus_glo30';
  return 'copernicus_glo90';
}

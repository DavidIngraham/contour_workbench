/** Shared browser transforms for current and legacy geographic layouts. */
import type { Layout } from './types';
const metersPerDegree = 111319.490793;

/** Rotate geographic coordinates into printer millimeters. */
export function modelXY(l: Layout, p: number[]): [number, number] {
  if (l.rotation_deg != null) {
    const angle = (l.rotation_deg * Math.PI) / 180;
    const x =
      (p[0] - l.bounds[0]) *
      metersPerDegree *
      Math.cos(((l.bounds[1] + l.bounds[3]) * Math.PI) / 360);
    const y = (p[1] - l.bounds[1]) * metersPerDegree;
    return [
      (x * Math.cos(angle) - y * Math.sin(angle) - (l.offset_m?.[0] ?? 0)) * l.scale,
      (x * Math.sin(angle) + y * Math.cos(angle) - (l.offset_m?.[1] ?? 0)) * l.scale,
    ];
  }
  const u = (p[0] - l.bounds[0]) / (l.bounds[2] - l.bounds[0]);
  const v = (p[1] - l.bounds[1]) / (l.bounds[3] - l.bounds[1]);
  return l.rotated ? [(1 - v) * l.width, u * l.depth] : [u * l.width, v * l.depth];
}

/** Invert printer coordinates to longitude/latitude, including legacy 90° layouts. */
export function modelLonLat(l: Layout, p: number[]): [number, number] {
  if (l.rotation_deg != null) {
    const angle = (l.rotation_deg * Math.PI) / 180;
    const x = p[0] / l.scale + (l.offset_m?.[0] ?? 0);
    const y = p[1] / l.scale + (l.offset_m?.[1] ?? 0);
    return [
      l.bounds[0] +
        (x * Math.cos(angle) + y * Math.sin(angle)) /
          (metersPerDegree * Math.cos(((l.bounds[1] + l.bounds[3]) * Math.PI) / 360)),
      l.bounds[1] + (-x * Math.sin(angle) + y * Math.cos(angle)) / metersPerDegree,
    ];
  }
  const u = l.rotated ? p[1] / l.depth : p[0] / l.width;
  const v = l.rotated ? 1 - p[0] / l.width : p[1] / l.depth;
  return [
    l.bounds[0] + u * (l.bounds[2] - l.bounds[0]),
    l.bounds[1] + v * (l.bounds[3] - l.bounds[1]),
  ];
}

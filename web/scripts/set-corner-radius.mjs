import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath, radiusArg] = process.argv.slice(2);
if (!inputPath || !outputPath || !radiusArg) {
  console.error(
    'Usage: node scripts/set-corner-radius.mjs <input.contour.json> <output.contour.json> <radius-m>',
  );
  process.exit(2);
}
const project = JSON.parse(await readFile(inputPath, 'utf8')),
  radiusM = Number(radiusArg);
if (!Number.isFinite(radiusM) || radiusM < 0)
  throw new Error('Corner radius must be zero or greater.');
const points = project.extent_editor?.points;
if (!Array.isArray(points) || points.length < 3)
  throw new Error('The project needs at least three editable extent points.');
const metersPerDegree = 111319.490793;
const center = [
  points.reduce((sum, point) => sum + point[0], 0) / points.length,
  points.reduce((sum, point) => sum + point[1], 0) / points.length,
];
const xScale = metersPerDegree * Math.cos((center[1] * Math.PI) / 180);
const toXY = point => [(point[0] - center[0]) * xScale, (point[1] - center[1]) * metersPerDegree];
const toGeo = point => [center[0] + point[0] / xScale, center[1] + point[1] / metersPerDegree];
const xy = points.map(toXY),
  rounded = [];
for (let i = 0; i < xy.length; i++) {
  const p = xy[i],
    prev = xy[(i + xy.length - 1) % xy.length],
    next = xy[(i + 1) % xy.length];
  const a = Math.hypot(p[0] - prev[0], p[1] - prev[1]),
    b = Math.hypot(next[0] - p[0], next[1] - p[1]);
  if (a < 1e-8 || b < 1e-8) continue;
  const u = [(p[0] - prev[0]) / a, (p[1] - prev[1]) / a],
    v = [(next[0] - p[0]) / b, (next[1] - p[1]) / b];
  const turn = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
  if (Math.abs(turn) < 1e-5) {
    rounded.push(p);
    continue;
  }
  const tangent = Math.min(radiusM * Math.tan(Math.abs(turn) / 2), a * 0.45, b * 0.45),
    r = tangent / Math.tan(Math.abs(turn) / 2),
    sign = Math.sign(turn);
  const start = [p[0] - u[0] * tangent, p[1] - u[1] * tangent],
    arcCenter = [start[0] - u[1] * sign * r, start[1] + u[0] * sign * r],
    angle = Math.atan2(start[1] - arcCenter[1], start[0] - arcCenter[0]);
  const steps = Math.max(
    1,
    Math.min(Math.ceil(Math.abs(turn) / (Math.PI / 18)), Math.floor(480 / points.length) - 1),
  );
  for (let step = 0; step <= steps; step++) {
    const theta = angle + (turn * step) / steps;
    rounded.push([arcCenter[0] + r * Math.cos(theta), arcCenter[1] + r * Math.sin(theta)]);
  }
}
project.settings = { ...project.settings, boundary: rounded.map(toGeo) };
project.extent_editor = { ...project.extent_editor, points, center, corner_radius_m: radiusM };
await writeFile(outputPath, JSON.stringify(project));
console.log(
  `Updated ${project.name} with a ${radiusM.toLocaleString()} m corner radius while preserving its ${project.extent_editor.shape} footprint.`,
);

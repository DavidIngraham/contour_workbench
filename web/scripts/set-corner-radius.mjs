import { readFile, writeFile } from 'node:fs/promises';
import { extentPolygon } from '../src/extent-shapes.ts';

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
if (!project.extent_editor || project.extent_editor.points?.length < 3)
  throw new Error('The project needs at least three editable extent points.');

project.extent_editor = { ...project.extent_editor, corner_radius_m: radiusM };
project.settings = {
  ...project.settings,
  boundary: extentPolygon(project.extent_editor, project.settings?.max_print_size_mm ?? [248, 198]),
};
await writeFile(outputPath, JSON.stringify(project));
console.log(
  `Updated ${project.name} with a ${radiusM.toLocaleString()} m corner radius and ${project.settings.boundary.length} adaptive boundary vertices.`,
);

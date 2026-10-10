/** Target-specific archive encoders used only by the disposable export worker. */
import { strToU8, zipSync, zlibSync } from 'fflate';
import { buildThreeMf, type ThreeMfKind } from './three-mf';
import { projectMaterialGroups, type Asset, type Mesh, type Project } from './types';

export type ExportFormat =
  'stl' | 'portable' | 'bambu' | 'prusa' | 'shapeways-color' | 'shapeways-stl' | 'shapeways-3mf';

export interface ExportResult {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

const safeName = (value: string) =>
  value.replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').trim() || 'Contour Workbench';

function stl(meshes: Array<{ mesh: Mesh; origin: [number, number, number] }>) {
  let out = 'solid contour_workbench\n';
  for (const entry of meshes)
    for (let i = 0; i < entry.mesh.indices.length; i += 3) {
      out += 'facet normal 0 0 0\nouter loop\n';
      for (let k = 0; k < 3; k++) {
        const j = Number(entry.mesh.indices[i + k]) * 3;
        out +=
          'vertex ' +
          (Number(entry.mesh.positions[j]) + entry.origin[0]) +
          ' ' +
          (Number(entry.mesh.positions[j + 1]) + entry.origin[1]) +
          ' ' +
          (Number(entry.mesh.positions[j + 2]) + entry.origin[2]) +
          '\n';
      }
      out += 'endloop\nendfacet\n';
    }
  return strToU8(out + 'endsolid contour_workbench\n');
}

/** Validate that every undirected edge is shared by exactly two oppositely wound faces. */
export function validateWatertight(mesh: Mesh, label: string) {
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i < mesh.indices.length; i += 3)
    for (const [a0, b0] of [
      [Number(mesh.indices[i]), Number(mesh.indices[i + 1])],
      [Number(mesh.indices[i + 1]), Number(mesh.indices[i + 2])],
      [Number(mesh.indices[i + 2]), Number(mesh.indices[i])],
    ]) {
      const key = a0 < b0 ? a0 + ':' + b0 : b0 + ':' + a0;
      const count = edges.get(key) || [0, 0];
      count[a0 < b0 ? 0 : 1]++;
      edges.set(key, count);
    }
  const broken = [...edges.values()].find(edge => edge[0] !== 1 || edge[1] !== 1);
  if (broken) throw new Error(label + ' is not watertight.');
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(name: string, data: Uint8Array) {
  const type = strToU8(name);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(type, 4);
  out.set(data, 8);
  const checksum = new Uint8Array(type.length + data.length);
  checksum.set(type);
  checksum.set(data, type.length);
  view.setUint32(8 + data.length, crc32(checksum));
  return out;
}
function colorTexture(colors: string[]) {
  const rgba = colors.flatMap(color => {
    const hex = color.replace('#', '').padEnd(6, '0');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255,
    ];
  });
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, colors.length);
  view.setUint32(4, 1);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(1 + rgba.length);
  raw.set(rgba, 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function validateShapewaysLimits(triangles: number, archiveBytes = 0) {
  if (triangles > 1000000)
    throw new Error('Shapeways color export exceeds the one-million-triangle safety limit.');
  if (archiveBytes > 64 * 1024 * 1024)
    throw new Error('Shapeways color ZIP exceeds the 64 MiB safety limit.');
}

function shapewaysColor(asset: Asset, project: Project) {
  const groups = projectMaterialGroups(project);
  const materialEntry = (id: string) => {
    const index = groups.findIndex(group => group.id === id);
    const safeIndex = index < 0 ? 1 : index;
    return {
      material: groups[safeIndex].name,
      uv: (safeIndex + 0.5) / groups.length,
    };
  };
  const entries = [
    {
      name: 'terrain',
      mesh: asset.terrain,
      origin: [0, 0, 0] as [number, number, number],
      ...materialEntry('terrain'),
    },
    ...asset.inserts.map(piece => ({
      name: piece.id,
      mesh: piece.mesh,
      origin: piece.origin,
      ...materialEntry(piece.class),
    })),
  ];
  let obj = 'mtllib model.mtl\n';
  let vertex = 1;
  let texture = 1;
  for (const entry of entries) {
    validateWatertight(entry.mesh, entry.name);
    obj +=
      'o ' +
      entry.name.replace(/\s+/g, '_') +
      '\nusemtl ' +
      entry.material.replace(/\s+/g, '_') +
      '\n';
    for (let i = 0; i < entry.mesh.positions.length; i += 3)
      obj +=
        'v ' +
        (Number(entry.mesh.positions[i]) + entry.origin[0]) +
        ' ' +
        (Number(entry.mesh.positions[i + 1]) + entry.origin[1]) +
        ' ' +
        (Number(entry.mesh.positions[i + 2]) + entry.origin[2]) +
        '\n';
    for (let i = 0; i < entry.mesh.positions.length; i += 3) obj += 'vt ' + entry.uv + ' 0.5\n';
    for (let i = 0; i < entry.mesh.indices.length; i += 3) {
      const a = Number(entry.mesh.indices[i]);
      const b = Number(entry.mesh.indices[i + 1]);
      const c = Number(entry.mesh.indices[i + 2]);
      obj +=
        'f ' +
        (vertex + a) +
        '/' +
        (texture + a) +
        ' ' +
        (vertex + b) +
        '/' +
        (texture + b) +
        ' ' +
        (vertex + c) +
        '/' +
        (texture + c) +
        '\n';
    }
    vertex += entry.mesh.positions.length / 3;
    texture += entry.mesh.positions.length / 3;
  }
  const mtl = groups
    .map(
      (group, index) =>
        'newmtl ' +
        group.name.replace(/\s+/g, '_') +
        '\nmap_Kd colors.png\nKd 1 1 1\n# texture-column ' +
        index +
        '\n',
    )
    .join('\n');
  const triangleCount = entries.reduce((sum, entry) => sum + entry.mesh.indices.length / 3, 0);
  validateShapewaysLimits(triangleCount);
  const files = {
    'model.obj': strToU8(obj),
    'model.mtl': strToU8(mtl),
    'colors.png': colorTexture(groups.map(group => group.color)),
    'README.txt': strToU8(
      'Units: millimeters\nUpload model.obj with model.mtl and colors.png as one ZIP.\n',
    ),
  };
  const zip = zipSync(files, { level: 6 });
  validateShapewaysLimits(triangleCount, zip.byteLength);
  return zip;
}

function assembledMeshes(asset: Asset) {
  return [
    { mesh: asset.terrain, origin: [0, 0, 0] as [number, number, number] },
    ...asset.inserts.map(piece => ({ mesh: piece.mesh, origin: piece.origin })),
  ];
}

/** Encode one requested target without retaining state after the worker exits. */
export function buildExport(
  format: ExportFormat,
  asset: Asset,
  project: Project,
  projectFile?: Uint8Array,
): ExportResult {
  const stem = safeName(project.name);
  if (format === 'stl') {
    const files: Record<string, Uint8Array> = {
      'terrain.stl': stl([{ mesh: asset.terrain, origin: [0, 0, 0] }]),
      'project.contour.json': projectFile || strToU8(JSON.stringify(project)),
      'validation.json': strToU8(JSON.stringify(asset.validation, null, 2)),
      'attribution.txt': strToU8(
        project.source.attribution +
          '\nOpenStreetMap data: (c) OpenStreetMap contributors, ODbL.\n',
      ),
    };
    for (const piece of asset.inserts)
      files['inserts/' + safeName(piece.id) + '.stl'] = stl([
        {
          mesh: piece.mesh,
          origin: project.settings.manufacturing_mode === 'multicolor' ? piece.origin : [0, 0, 0],
        },
      ]);
    files['insert_manifest.json'] = strToU8(
      JSON.stringify(
        {
          units: 'mm',
          manufacturing_mode: project.settings.manufacturing_mode,
          coordinates:
            project.settings.manufacturing_mode === 'multicolor' ? 'assembly' : 'part-local',
          pieces: asset.inserts.map(piece => ({
            file: safeName(piece.id) + '.stl',
            class: piece.class,
            assembly_origin_mm: piece.origin,
          })),
        },
        null,
        2,
      ),
    );
    files['README.txt'] = strToU8(
      asset.faceMaterials
        ? 'This STL contains the single exterior shape only. STL cannot store painted filament assignments; export Bambu Studio or PrusaSlicer 3MF to preserve those colors.\n'
        : project.settings.manufacturing_mode === 'multicolor'
          ? 'Print together: import all STL files as parts of one object and preserve their coordinates. Assign materials in your slicer. These parts share zero-clearance interfaces and are not fitted removable inserts.\n'
          : 'Separate inserts: print terrain and insert files separately, then assemble. Insert files use local coordinates; insert_manifest.json records their assembly positions.\n',
    );
    return {
      bytes: zipSync(files, { level: 3 }),
      filename: stem + '.zip',
      mime: 'application/zip',
    };
  }
  if (format === 'shapeways-color')
    return {
      bytes: shapewaysColor(asset, project),
      filename: stem + '-shapeways-color.zip',
      mime: 'application/zip',
    };
  if (format === 'shapeways-stl') {
    for (const [index, entry] of assembledMeshes(asset).entries())
      validateWatertight(entry.mesh, index ? 'Insert ' + index : 'Terrain');
    return {
      bytes: stl(assembledMeshes(asset)),
      filename: stem + '-shapeways.stl',
      mime: 'model/stl',
    };
  }
  if (format === 'shapeways-3mf')
    for (const [index, entry] of assembledMeshes(asset).entries())
      validateWatertight(entry.mesh, index ? 'Insert ' + index : 'Terrain');
  const kind: ThreeMfKind =
    format === 'bambu'
      ? 'bambu'
      : format === 'prusa'
        ? 'prusa'
        : format === 'shapeways-3mf'
          ? 'shapeways'
          : 'portable';
  return {
    bytes: buildThreeMf(asset, project, kind, projectFile),
    filename: stem + (kind === 'portable' ? '.3mf' : '-' + kind + '.3mf'),
    mime: 'model/3mf',
  };
}

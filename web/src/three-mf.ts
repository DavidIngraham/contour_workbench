/** Portable and Bambu-oriented 3MF package generation. All model coordinates are millimeters. */
import { strToU8, zipSync } from 'fflate';
import type { Asset, Mesh, Piece, Project } from './types';

/** Supported 3MF packaging variants. */
export type ThreeMfKind = 'portable' | 'bambu';

interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
  width: number;
  depth: number;
  height: number;
}
interface ObjectRecord {
  id: number;
  name: string;
  mesh: Mesh;
  kind: 'terrain' | 'insert';
  piece?: Piece;
}
interface Placement {
  object: ObjectRecord;
  plate: number;
  translation: [number, number, number];
}

const xmlEscape = (value: unknown) =>
  String(value).replace(
    /[<>&"']/g,
    char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
const safeName = (value: string) =>
  value.replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').trim() || 'Contour Workbench';

function bounds(mesh: Mesh): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity],
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3)
    for (let axis = 0; axis < 3; axis++) {
      const value = Number(mesh.positions[i + axis]);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  if (!Number.isFinite(min[0])) throw new Error('Cannot export an empty mesh to 3MF.');
  return { min, max, width: max[0] - min[0], depth: max[1] - min[1], height: max[2] - min[2] };
}

function transform([x, y, z]: [number, number, number]) {
  return `1 0 0 0 1 0 0 0 1 ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`;
}

function meshXml(mesh: Mesh) {
  let vertices = '';
  for (let i = 0; i < mesh.positions.length; i += 3)
    vertices += `<vertex x="${Number(mesh.positions[i]).toFixed(6)}" y="${Number(mesh.positions[i + 1]).toFixed(6)}" z="${Number(mesh.positions[i + 2]).toFixed(6)}"/>`;
  let triangles = '';
  for (let i = 0; i < mesh.indices.length; i += 3)
    triangles += `<triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${mesh.indices[i + 2]}"/>`;
  return `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh>`;
}

function records(asset: Asset): ObjectRecord[] {
  return [
    { id: 1, name: 'Terrain', mesh: asset.terrain, kind: 'terrain' },
    ...asset.inserts.map((piece, index) => ({
      id: index + 2,
      name: piece.id,
      mesh: piece.mesh,
      kind: 'insert' as const,
      piece,
    })),
  ];
}

function assembledPlacement(objects: ObjectRecord[]): Placement[] {
  return objects.map(object => ({
    object,
    plate: 1,
    translation: object.piece ? object.piece.origin : [0, 0, 0],
  }));
}

function packedPlacement(objects: ObjectRecord[], bed: [number, number]): Placement[] {
  const margin = Math.max(3, Math.min(8, Math.min(...bed) * 0.025)),
    usableW = bed[0] - 2 * margin,
    usableD = bed[1] - 2 * margin;
  if (usableW <= 0 || usableD <= 0)
    throw new Error('The configured print bed is too small for 3MF plate layout.');
  const terrain = objects[0],
    tb = bounds(terrain.mesh);
  if (tb.width > bed[0] + 0.05 || tb.depth > bed[1] + 0.05)
    throw new Error(
      `Terrain is ${tb.width.toFixed(1)} x ${tb.depth.toFixed(1)} mm, larger than the configured ${bed[0]} x ${bed[1]} mm bed.`,
    );
  const result: Placement[] = [
    {
      object: terrain,
      plate: 1,
      translation: [
        (bed[0] - tb.width) / 2 - tb.min[0],
        (bed[1] - tb.depth) / 2 - tb.min[1],
        -tb.min[2],
      ],
    },
  ];
  let plate = 2,
    x = margin,
    y = margin,
    rowDepth = 0;
  for (const object of objects.slice(1)) {
    const b = bounds(object.mesh);
    if (b.width > usableW + 0.05 || b.depth > usableD + 0.05)
      throw new Error(
        `Insert "${object.name}" is ${b.width.toFixed(1)} x ${b.depth.toFixed(1)} mm and does not fit the configured print bed.`,
      );
    if (x + b.width > bed[0] - margin + 0.05) {
      x = margin;
      y += rowDepth + margin;
      rowDepth = 0;
    }
    if (y + b.depth > bed[1] - margin + 0.05) {
      plate++;
      x = margin;
      y = margin;
      rowDepth = 0;
    }
    result.push({ object, plate, translation: [x - b.min[0], y - b.min[1], -b.min[2]] });
    x += b.width + margin;
    rowDepth = Math.max(rowDepth, b.depth);
  }
  return result;
}

function coreModel(
  project: Project,
  objects: ObjectRecord[],
  placements: Placement[],
  kind: ThreeMfKind,
) {
  const objectXml = objects
    .map(
      object =>
        `<object id="${object.id}" name="${xmlEscape(object.name)}" type="model" pid="1" pindex="${object.kind === 'terrain' ? 0 : 1}">${meshXml(object.mesh)}</object>`,
    )
    .join('');
  const build = placements
    .map(
      ({ object, translation }) =>
        `<item objectid="${object.id}" transform="${transform(translation)}"/>`,
    )
    .join('');
  const title = xmlEscape(project.name);
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${title}</metadata><metadata name="Designer">Contour Workbench</metadata><metadata name="Description">${kind === 'portable' ? 'Assembled terrain and inserts' : 'Bambu Studio multi-plate terrain project'}</metadata><resources><basematerials id="1"><base name="Terrain" displaycolor="#8BAA73FF"/><base name="Inserts" displaycolor="#F4B45EFF"/></basematerials>${objectXml}</resources><build>${build}</build></model>`;
}

function modelSettings(objects: ObjectRecord[], placements: Placement[]) {
  const byPlate = new Map<number, Placement[]>();
  for (const placement of placements)
    byPlate.set(placement.plate, [...(byPlate.get(placement.plate) || []), placement]);
  const objectXml = objects
    .map(object => {
      const faces = Math.floor(object.mesh.indices.length / 3);
      return `<object id="${object.id}"><metadata key="name" value="${xmlEscape(object.name)}"/><metadata key="extruder" value="1"/><metadata face_count="${faces}"/><part id="${object.id}" subtype="normal_part"><metadata key="name" value="${xmlEscape(object.name)}"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/><mesh_stat face_count="${faces}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part></object>`;
    })
    .join('');
  const plateXml = [...byPlate.entries()]
    .map(
      ([plate, items]) =>
        `<plate><metadata key="plater_id" value="${plate}"/><metadata key="plater_name" value="${plate === 1 ? 'Terrain' : 'Inserts ' + (plate - 1)}"/><metadata key="locked" value="false"/>${items.map(item => `<model_instance><metadata key="object_id" value="${item.object.id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${item.object.id}"/></model_instance>`).join('')}</plate>`,
    )
    .join('');
  const assembly = placements
    .map(
      item =>
        `<assemble_item object_id="${item.object.id}" instance_id="0" transform="${transform(item.translation)}" offset="0 0 0"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><config>${objectXml}${plateXml}<assemble>${assembly}</assemble></config>`;
}

/** Derive portable Bambu process hints from nozzle diameter. */
export function bambuProcessSettings(project: Project) {
  const nozzle = project.settings.nozzle_diameter_mm;
  const layer = Math.max(0.08, Math.min(0.32, nozzle * 0.5)).toFixed(2);
  return {
    layer_height: layer,
    initial_layer_print_height: Math.max(0.2, Number(layer)).toFixed(2),
    wall_loops: '3',
    top_shell_layers: '4',
    bottom_shell_layers: '4',
    sparse_infill_density: '15%',
    sparse_infill_pattern: 'grid',
    brim_type: 'auto_brim',
    brim_width: '5',
    elefant_foot_compensation: '0',
  };
}

function contentTypes(kind: ThreeMfKind) {
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/>${kind === 'bambu' ? '<Default Extension="config" ContentType="application/octet-stream"/>' : ''}</Types>`;
}

const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** Build an assembled portable 3MF or a Bambu multi-plate archive. */
export function buildThreeMf(asset: Asset, project: Project, kind: ThreeMfKind): Uint8Array {
  const objects = records(asset),
    placements =
      kind === 'portable'
        ? assembledPlacement(objects)
        : packedPlacement(objects, project.settings.max_print_size_mm);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(kind)),
    '_rels/.rels': strToU8(relationships),
    '3D/3dmodel.model': strToU8(coreModel(project, objects, placements, kind)),
    'Metadata/project.contour.json': strToU8(JSON.stringify(project)),
    'Metadata/contour_workbench.json': strToU8(
      JSON.stringify(
        {
          generator: 'Contour Workbench',
          format: kind,
          project: safeName(project.name),
          units: 'mm',
          source: project.source,
          validation: asset.validation,
          bed_size_mm: project.settings.max_print_size_mm,
          plates: [...new Set(placements.map(item => item.plate))].map(plate => ({
            plate,
            objects: placements.filter(item => item.plate === plate).map(item => item.object.name),
          })),
          inserts: asset.inserts.map(piece => ({
            name: piece.id,
            class: piece.class,
            assembly_origin_mm: piece.origin,
            taper_relief_mm: piece.taper_relief_mm,
            taper_height_mm: piece.taper_height_mm,
            draft_angle_deg: piece.draft_angle_deg,
          })),
        },
        null,
        2,
      ),
    ),
  };
  if (kind === 'bambu') {
    files['Metadata/project_settings.config'] = strToU8(
      JSON.stringify(bambuProcessSettings(project), null, 2),
    );
    files['Metadata/model_settings.config'] = strToU8(modelSettings(objects, placements));
  }
  return zipSync(files, { level: 6 });
}

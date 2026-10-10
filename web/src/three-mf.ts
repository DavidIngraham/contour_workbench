/** Portable and Bambu-oriented 3MF package generation. All model coordinates are millimeters. */
import { strToU8, zipSync } from 'fflate';
import { projectMaterialGroups, type Asset, type Mesh, type Piece, type Project } from './types';
import { validateThreeMfFiles, validateThreeMfMesh } from './three-mf-validation';

/** Supported 3MF packaging variants. */
export type ThreeMfKind = 'portable' | 'bambu' | 'prusa' | 'shapeways';

const coreNamespace = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const productionNamespace = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const bambuNamespace = 'http://schemas.bambulab.com/package/2021';
const modelRelationship = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const bambuBuildUuid = '2c7c17d8-22b5-4d84-8835-1976022ea369';
const bambuDefaultPlateStrideMm = 256;

function bambuUuid(id: number, suffix: string) {
  return String(id).padStart(8, '0') + suffix;
}

function bambuPartUuid(id: number, suffix: string) {
  return `${String(id).padStart(4, '0')}0000${suffix}`;
}

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

function materialIndex(project: Project, object: ObjectRecord) {
  const materials = projectMaterialGroups(project);
  const id = object.kind === 'terrain' ? 'terrain' : object.piece!.class;
  const index = materials.findIndex(group => group.id === id);
  return index < 0 ? (object.kind === 'terrain' ? 0 : 1) : index;
}

function baseMaterialsXml(project: Project) {
  return projectMaterialGroups(project)
    .map(
      group =>
        `<base name="${xmlEscape(group.name)}" displaycolor="${group.color.toUpperCase()}FF"/>`,
    )
    .join('');
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
  return result.map(item => {
    const plateIndex = item.plate - 1;
    const column = plateIndex % 2;
    const row = Math.floor(plateIndex / 2);
    return {
      ...item,
      translation: [
        item.translation[0] + column * Math.max(bambuDefaultPlateStrideMm, bed[0]),
        item.translation[1] - row * Math.max(bambuDefaultPlateStrideMm, bed[1]),
        item.translation[2],
      ],
    };
  });
}

// Standard 3MF has no portable multi-plate layout. Keep separate parts grounded
// and non-overlapping so the receiving slicer can arrange them onto its plates.
function separatePlacement(objects: ObjectRecord[]): Placement[] {
  let x = 0;
  return objects.map(object => {
    const b = bounds(object.mesh);
    const placement: Placement = {
      object,
      plate: 1,
      translation: [x - b.min[0], -b.min[1], -b.min[2]],
    };
    x += b.width + 5;
    return placement;
  });
}

interface AdaptiveFace {
  minZ: number;
  maxZ: number;
  nCos: number;
  nSin: number;
}

interface LayerHeightPoint {
  z: number;
  height: number;
}

function prusaAdaptiveLayerProfile(placements: Placement[], nozzle: number): LayerHeightPoint[] {
  const minLayerHeight = Math.max(0.04, nozzle * 0.175);
  const maxLayerHeight = Math.max(minLayerHeight, nozzle * 0.75);
  const layerHeight = Math.max(minLayerHeight, Math.min(maxLayerHeight, nozzle * 0.5));
  const firstLayerHeight = Math.max(0.2, layerHeight);
  const faces: AdaptiveFace[] = [];
  let objectMinZ = Number.POSITIVE_INFINITY;
  let objectMaxZ = Number.NEGATIVE_INFINITY;

  for (const { object, translation } of placements) {
    const { positions, indices } = object.mesh;
    for (let index = 0; index < indices.length; index += 3) {
      const ia = indices[index] * 3;
      const ib = indices[index + 1] * 3;
      const ic = indices[index + 2] * 3;
      const ax = Number(positions[ia]) + translation[0];
      const ay = Number(positions[ia + 1]) + translation[1];
      const az = Number(positions[ia + 2]) + translation[2];
      const bx = Number(positions[ib]) + translation[0];
      const by = Number(positions[ib + 1]) + translation[1];
      const bz = Number(positions[ib + 2]) + translation[2];
      const cx = Number(positions[ic]) + translation[0];
      const cy = Number(positions[ic + 1]) + translation[1];
      const cz = Number(positions[ic + 2]) + translation[2];
      objectMinZ = Math.min(objectMinZ, az, bz, cz);
      objectMaxZ = Math.max(objectMaxZ, az, bz, cz);
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 1e-9)
        faces.push({
          minZ: Math.min(az, bz, cz),
          maxZ: Math.max(az, bz, cz),
          nCos: Math.abs(nz) / length,
          nSin: Math.hypot(nx, ny) / length,
        });
    }
  }

  if (!faces.length || !Number.isFinite(objectMinZ) || objectMaxZ <= objectMinZ)
    return [
      { z: 0, height: firstLayerHeight },
      { z: firstLayerHeight, height: firstLayerHeight },
    ];
  for (const face of faces) {
    face.minZ -= objectMinZ;
    face.maxZ -= objectMinZ;
  }
  faces.sort((left, right) => left.minZ - right.minZ || left.maxZ - right.maxZ);

  const objectHeight = objectMaxZ - objectMinZ;
  if (objectHeight <= firstLayerHeight) {
    const thinLayerHeight = Math.max(minLayerHeight, objectHeight);
    return [
      { z: 0, height: thinLayerHeight },
      { z: objectHeight, height: thinLayerHeight },
    ];
  }
  const profile: LayerHeightPoint[] = [
    { z: 0, height: firstLayerHeight },
    { z: firstLayerHeight, height: firstLayerHeight },
  ];
  let printZ = firstLayerHeight;
  let currentFacet = 0;
  while (printZ + 1e-6 < objectHeight) {
    let height = maxLayerHeight;
    let orderedId = currentFacet;
    let firstHit = false;
    for (; orderedId < faces.length; orderedId++) {
      const face = faces[orderedId];
      if (face.minZ >= printZ) break;
      if (face.maxZ > printZ) {
        if (!firstHit) {
          firstHit = true;
          currentFacet = orderedId;
        }
        if (face.maxZ < printZ + 1e-6) continue;
        const slopeHeight = Math.min(
          layerHeight / 0.184,
          face.nCos > 1e-5
            ? 1.44 * layerHeight * Math.sqrt(face.nSin / face.nCos)
            : Number.POSITIVE_INFINITY,
        );
        height = Math.min(height, Math.max(minLayerHeight, slopeHeight));
      }
    }
    if (height > minLayerHeight) {
      for (; orderedId < faces.length; orderedId++) {
        const face = faces[orderedId];
        if (face.minZ >= printZ + height) break;
        if (face.maxZ < printZ + 1e-6) continue;
        const slopeHeight = Math.min(
          layerHeight / 0.184,
          face.nCos > 1e-5
            ? 1.44 * layerHeight * Math.sqrt(face.nSin / face.nCos)
            : Number.POSITIVE_INFINITY,
        );
        const reducedHeight = Math.max(minLayerHeight, slopeHeight);
        const zDifference = face.minZ - printZ;
        if (reducedHeight < zDifference) height = zDifference;
        else height = Math.min(height, reducedHeight);
      }
      height = Math.max(minLayerHeight, height);
    }
    const remainingHeight = objectHeight - printZ;
    if (remainingHeight < minLayerHeight) {
      profile.push({ z: objectHeight, height: minLayerHeight });
      printZ = objectHeight;
      break;
    }
    height = Math.min(maxLayerHeight, height, remainingHeight);
    if (height <= 1e-6) break;
    profile.push({ z: printZ, height });
    printZ += height;
  }
  if (Math.abs((profile.at(-1)?.z ?? 0) - objectHeight) > 1e-6) {
    const finalHeight = Math.max(
      minLayerHeight,
      Math.min(maxLayerHeight, objectHeight - profile.at(-1)!.z),
    );
    profile.push({ z: objectHeight, height: finalHeight });
  }
  return profile;
}

function layerHeightProfileLine(objectId: number, placements: Placement[], nozzle: number) {
  const values = prusaAdaptiveLayerProfile(placements, nozzle)
    .flatMap(point => [point.z.toFixed(6), point.height.toFixed(6)])
    .join(';');
  return `object_id=${objectId}|${values}\n`;
}

function prusaLayerHeightProfile(placements: Placement[], nozzle: number) {
  return layerHeightProfileLine(1, placements, nozzle);
}

function bambuLayerHeightProfiles(placements: Placement[], nozzle: number) {
  return placements
    .map((placement, index) => layerHeightProfileLine(index + 1, [placement], nozzle))
    .join('');
}

function prusaModel(project: Project, objects: ObjectRecord[], placements: Placement[]) {
  const materialId = objects.length + 2;
  const materials = projectMaterialGroups(project);
  const meshObjects = objects
    .map(object => {
      const index = materialIndex(project, object);
      const group = materials[index];
      return (
        '<object id="' +
        object.id +
        '" name="' +
        xmlEscape(object.name) +
        '" type="model" pid="' +
        materialId +
        '" pindex="' +
        index +
        '"><metadata name="slic3rpe:extruder_id">' +
        group.extruder +
        '</metadata>' +
        meshXml(object.mesh) +
        '</object>'
      );
    })
    .join('');
  const assemblyId = objects.length + 1;
  if (project.settings.manufacturing_mode === 'separate') {
    const build = placements
      .map(
        item => `<item objectid="${item.object.id}" transform="${transform(item.translation)}"/>`,
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${coreNamespace}" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="slic3rpe:Version3mf">1</metadata><resources><basematerials id="${materialId}">${baseMaterialsXml(project)}</basematerials>${meshObjects}</resources><build>${build}</build></model>`;
  }
  const components = placements
    .map(
      item =>
        '<component objectid="' +
        item.object.id +
        '" transform="' +
        transform(item.translation) +
        '"/>',
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="Application">Contour Workbench</metadata><metadata name="slic3rpe:Version3mf">1</metadata><metadata name="Title">' +
    xmlEscape(project.name) +
    '</metadata><resources><basematerials id="' +
    materialId +
    '">' +
    baseMaterialsXml(project) +
    '</basematerials>' +
    meshObjects +
    '<object id="' +
    assemblyId +
    '" name="' +
    xmlEscape(project.name) +
    '" type="model"><components>' +
    components +
    '</components></object></resources><build><item objectid="' +
    assemblyId +
    '"/></build></model>'
  );
}

function coreModel(
  project: Project,
  objects: ObjectRecord[],
  placements: Placement[],
  kind: ThreeMfKind,
) {
  if (kind === 'prusa') return prusaModel(project, objects, placements);
  const materialId = objects.length + 2;
  const objectXml = objects
    .map(
      object =>
        `<object id="${object.id}" name="${xmlEscape(object.name)}" type="model" pid="${materialId}" pindex="${kind === 'shapeways' ? 0 : materialIndex(project, object)}">${meshXml(object.mesh)}</object>`,
    )
    .join('');
  const build = placements
    .map(
      ({ object, translation }) =>
        `<item objectid="${object.id}" transform="${transform(translation)}"/>`,
    )
    .join('');
  const title = xmlEscape(project.name);
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${title}</metadata><metadata name="Designer">Contour Workbench</metadata><metadata name="Description">${kind === 'bambu' ? 'Bambu Studio multipart terrain project' : kind === 'shapeways' ? 'Shapeways single-material terrain model' : 'Assembled terrain and inserts'}</metadata><resources><basematerials id="${materialId}">${baseMaterialsXml(project)}</basematerials>${objectXml}</resources><build>${build}</build></model>`;
}

function bambuRootModel(project: Project, objects: ObjectRecord[], placements: Placement[]) {
  const title = xmlEscape(project.name);
  const resourceXml = objects
    .map(
      object =>
        `<object id="${object.id * 2}" name="${xmlEscape(object.name)}" p:UUID="${bambuUuid(object.id, '-61cb-4c03-9d28-80fed5dfa1dc')}" type="model"><components><component p:path="/3D/Objects/object_${object.id}.model" objectid="${object.id * 2 - 1}" p:UUID="${bambuPartUuid(object.id, '-b206-40ff-9872-83e8017abed1')}" transform="${transform([0, 0, 0])}"/></components></object>`,
    )
    .join('');
  const buildXml = placements
    .map(
      ({ object, translation }) =>
        `<item objectid="${object.id * 2}" p:UUID="${bambuUuid(object.id * 2, '-b1ec-4553-aec9-835e5b724bb4')}" transform="${transform(translation)}" printable="1"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${coreNamespace}" xmlns:BambuStudio="${bambuNamespace}" xmlns:p="${productionNamespace}" requiredextensions="p"><metadata name="Application">Contour Workbench</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="Title">${title}</metadata><metadata name="Designer">Contour Workbench</metadata><metadata name="Description">Bambu Studio multipart terrain project</metadata><resources>${resourceXml}</resources><build p:UUID="${bambuBuildUuid}">${buildXml}</build></model>`;
}

function bambuChildModel(project: Project, object: ObjectRecord) {
  const childId = object.id * 2 - 1;
  const objectUuid = bambuPartUuid(object.id, '-81cb-4c03-9d28-80fed5dfa1dc');
  const group = projectMaterialGroups(project)[materialIndex(project, object)];
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${coreNamespace}" xmlns:BambuStudio="${bambuNamespace}" xmlns:p="${productionNamespace}" requiredextensions="p"><metadata name="BambuStudio:3mfVersion">1</metadata><resources><basematerials id="1"><base name="${xmlEscape(group.name)}" displaycolor="${group.color.toUpperCase()}FF"/></basematerials><object id="${childId}" name="${xmlEscape(object.name)}" p:UUID="${objectUuid}" type="model" pid="1" pindex="0">${meshXml(object.mesh)}</object></resources><build/></model>`;
}

function bambuModelRelationships(objects: ObjectRecord[]) {
  const entries = objects
    .map(
      (object, index) =>
        `<Relationship Target="/3D/Objects/object_${object.id}.model" Id="rel-${index + 1}" Type="${modelRelationship}"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
}

function modelSettings(project: Project, objects: ObjectRecord[], placements: Placement[]) {
  const materials = projectMaterialGroups(project);
  const byPlate = new Map<number, Placement[]>();
  for (const placement of placements)
    byPlate.set(placement.plate, [...(byPlate.get(placement.plate) || []), placement]);
  const objectXml = objects
    .map(object => {
      const faces = Math.floor(object.mesh.indices.length / 3);
      return `<object id="${object.id * 2}"><metadata key="name" value="${xmlEscape(object.name)}"/><metadata key="extruder" value="${materials[materialIndex(project, object)].extruder}"/><metadata face_count="${faces}"/><part id="${object.id * 2 - 1}" subtype="normal_part"><metadata key="name" value="${xmlEscape(object.name)}"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/><mesh_stat face_count="${faces}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part></object>`;
    })
    .join('');
  const plateXml = [...byPlate.entries()]
    .map(
      ([plate, items]) =>
        `<plate><metadata key="plater_id" value="${plate}"/><metadata key="plater_name" value="${plate === 1 ? 'Terrain' : 'Inserts ' + (plate - 1)}"/><metadata key="locked" value="false"/>${items.map(item => `<model_instance><metadata key="object_id" value="${item.object.id * 2}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${item.object.id}"/></model_instance>`).join('')}</plate>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><config>${objectXml}${plateXml}<assemble/></config>`;
}

/** Derive portable Bambu process hints from nozzle diameter. */
export function bambuProcessSettings(project: Project) {
  const nozzle = project.settings.nozzle_diameter_mm;
  const layer = Math.max(0.08, Math.min(0.32, nozzle * 0.5)).toFixed(2);
  return {
    layer_height: layer,
    enable_prime_tower: '0',
    initial_layer_print_height: Math.max(0.2, Number(layer)).toFixed(2),
    wall_loops: '3',
    top_shell_layers: '4',
    bottom_shell_layers: '4',
    sparse_infill_density: '5%',
    sparse_infill_pattern: 'gyroid',
    brim_type: 'auto_brim',
    brim_width: '5',
  };
}

/** Derive PrusaSlicer process hints and enable its variable-layer-height capability. */
export function prusaProcessSettings(project: Project) {
  const nozzle = project.settings.nozzle_diameter_mm;
  const layer = Math.max(0.08, Math.min(0.32, nozzle * 0.5)).toFixed(2);
  return {
    layer_height: layer,
    first_layer_height: Math.max(0.2, Number(layer)).toFixed(2),
    perimeters: '3',
    top_solid_layers: '4',
    bottom_solid_layers: '4',
    fill_density: '5%',
    fill_pattern: 'gyroid',
    brim_width: '5',
    variable_layer_height: '1',
    wipe_tower: '0',
  };
}

function prusaPrintConfig(project: Project) {
  return (
    Object.entries(prusaProcessSettings(project))
      .map(([key, value]) => `; ${key} = ${value}`)
      .join('\n') + '\n'
  );
}

function contentTypes(kind: ThreeMfKind) {
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/>${kind === 'bambu' || kind === 'prusa' ? '<Default Extension="config" ContentType="application/octet-stream"/><Default Extension="txt" ContentType="text/plain"/>' : ''}</Types>`;
}

const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** Build an assembled portable 3MF or a Bambu multi-plate archive. */
export function buildThreeMf(
  asset: Asset,
  project: Project,
  kind: ThreeMfKind,
  projectFile?: Uint8Array,
): Uint8Array {
  const objects = records(asset);
  for (const object of objects) validateThreeMfMesh(object.mesh, object.name);
  const placements =
    project.settings.manufacturing_mode === 'multicolor' || kind === 'shapeways'
      ? assembledPlacement(objects)
      : kind === 'bambu'
        ? packedPlacement(objects, project.settings.max_print_size_mm)
        : separatePlacement(objects);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(kind)),
    '_rels/.rels': strToU8(relationships),
    '3D/3dmodel.model': strToU8(
      kind === 'bambu'
        ? bambuRootModel(project, objects, placements)
        : coreModel(project, objects, placements, kind),
    ),
    'Metadata/project.contour.json': projectFile || strToU8(JSON.stringify(project)),
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
    files['3D/_rels/3dmodel.model.rels'] = strToU8(bambuModelRelationships(objects));
    for (const object of objects)
      files[`3D/Objects/object_${object.id}.model`] = strToU8(bambuChildModel(project, object));
    files['Metadata/project_settings.config'] = strToU8(
      JSON.stringify(bambuProcessSettings(project), null, 2),
    );
    files['Metadata/model_settings.config'] = strToU8(modelSettings(project, objects, placements));
    files['Metadata/layer_heights_profile.txt'] = strToU8(
      bambuLayerHeightProfiles(placements, project.settings.nozzle_diameter_mm),
    );
  } else if (kind === 'prusa') {
    files['Metadata/Slic3r_PE.config'] = strToU8(prusaPrintConfig(project));
    files['Metadata/Slic3r_PE_layer_heights_profile.txt'] = strToU8(
      project.settings.manufacturing_mode === 'multicolor'
        ? prusaLayerHeightProfile(placements, project.settings.nozzle_diameter_mm)
        : placements
            .map((placement, index) =>
              layerHeightProfileLine(index + 1, [placement], project.settings.nozzle_diameter_mm),
            )
            .join(''),
    );
  }
  validateThreeMfFiles(files, kind);
  return zipSync(files, { level: 6 });
}

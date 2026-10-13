/** Portable and Bambu-oriented 3MF package generation. All model coordinates are millimeters. */
import { strToU8, zipSync } from 'fflate';
import { projectMaterialGroups, type Asset, type Mesh, type Piece, type Project } from './types';
import { validateThreeMfFiles, validateThreeMfMesh } from './three-mf-validation';
import { surfaceMaterials, trianglePaintCode } from './painted-surface';
import { filamentPlan } from './filaments';
import { bambuPrinter, type BambuPrinterId } from './bambu-printers';

/** Supported 3MF packaging variants. */
export type ThreeMfKind = 'portable' | 'bambu' | 'prusa' | 'shapeways';

/** Printer/layout options, independent of serialized terrain project settings. */
export interface ThreeMfOptions {
  sequentialSinglePlate?: boolean;
  bambuPrinter?: BambuPrinterId;
}

const coreNamespace = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const productionNamespace = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const bambuNamespace = 'http://schemas.bambulab.com/package/2021';
const modelRelationship = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const bambuBuildUuid = '2c7c17d8-22b5-4d84-8835-1976022ea369';

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
  faceMaterials?: Uint8Array;
}
interface Placement {
  object: ObjectRecord;
  plate: number;
  printSequence?: 'by layer' | 'by object';
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

function meshXml(
  mesh: Mesh,
  project?: Project,
  faceMaterials?: Uint8Array,
  kind?: ThreeMfKind,
  materialId?: number,
) {
  const groups = project ? projectMaterialGroups(project) : [];
  let vertices = '';
  for (let i = 0; i < mesh.positions.length; i += 3)
    vertices += `<vertex x="${Number(mesh.positions[i]).toFixed(6)}" y="${Number(mesh.positions[i + 1]).toFixed(6)}" z="${Number(mesh.positions[i + 2]).toFixed(6)}"/>`;
  let triangles = '';
  for (let i = 0; i < mesh.indices.length; i += 3) {
    let paint = '';
    if (faceMaterials) {
      const index = groups.findIndex(group => group.id === surfaceMaterials[faceMaterials[i / 3]]);
      if (index < 0) throw new Error('Painted triangle references an unknown material.');
      const code = trianglePaintCode(groups[index].extruder);
      paint =
        kind === 'bambu'
          ? ` paint_color="${code}"`
          : kind === 'prusa'
            ? ` slic3rpe:mmu_segmentation="${code}"`
            : ` pid="${materialId}" p1="${index}" p2="${index}" p3="${index}"`;
    }
    triangles += `<triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${mesh.indices[i + 2]}"${paint}/>`;
  }
  return `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh>`;
}

function records(asset: Asset): ObjectRecord[] {
  return [
    {
      id: 1,
      name: asset.faceMaterials ? 'Painted terrain' : 'Terrain',
      mesh: asset.terrain,
      kind: 'terrain',
      faceMaterials: asset.faceMaterials,
    },
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

// Separate-part previews retain class colors even in older projects whose
// feature groups all share slot 2. Split conflicting colors into free slots;
// preserve existing distinct slots and intentionally shared matching colors.
function separateFilamentGroups(project: Project, objects: ObjectRecord[]) {
  const groups = projectMaterialGroups(project);
  const used = new Set(objects.map(object => materialIndex(project, object)));
  const reserved = new Set(groups.filter((_, i) => used.has(i)).map(g => g.extruder));
  const assigned = new Map<number, string>();
  const splitSlots = new Map<string, number>();
  return groups.map((group, i) => {
    if (!used.has(i)) return group;
    const color = group.color.toUpperCase();
    let extruder = group.extruder;
    if (assigned.has(extruder) && assigned.get(extruder) !== color) {
      const key = `${extruder}:${color}`;
      if (splitSlots.has(key)) extruder = splitSlots.get(key)!;
      else {
        extruder = 1;
        while (reserved.has(extruder)) extruder++;
        if (extruder > 16) throw new Error('Separate colors require more than 16 filament slots.');
        reserved.add(extruder);
        splitSlots.set(key, extruder);
      }
    }
    assigned.set(extruder, color);
    return { ...group, extruder };
  });
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

function packedPlacement(
  objects: ObjectRecord[],
  project: Project,
  printerId: BambuPrinterId,
  singlePlate: boolean,
): Placement[] {
  const printer = bambuPrinter(printerId);
  const margin = 4; // Includes the explicit 3 mm brim and rounding tolerance.
  type Packed = { object: ObjectRecord; b: Bounds3; x: number; y: number };
  const entries = objects.map(object => ({ object, b: bounds(object.mesh) }));
  const groups = projectMaterialGroups(project);
  const slot = (object: ObjectRecord) => groups[materialIndex(project, object)].extruder;
  const mixed = (plate: { object: ObjectRecord }[]) =>
    new Set(plate.map(p => slot(p.object))).size > 1;
  for (const { object, b } of entries) {
    if (
      b.width > printer.bedMm - 2 * margin ||
      b.depth > printer.bedMm - 2 * margin ||
      b.height > printer.heightMm
    )
      throw new Error(
        `"${object.name}" does not fit ${printer.name}. Choose a larger printer or reduce the model size in Print setup.`,
      );
  }
  // Try several deterministic first-fit orders. Bounding rectangles deliberately
  // overestimate irregular outlines; never trade clearance for fewer plates.
  const orders = [
    [...entries].sort(
      (a, b) => b.b.width * b.b.depth - a.b.width * a.b.depth || a.object.id - b.object.id,
    ),
    [...entries].sort(
      (a, b) => b.b.depth - a.b.depth || b.b.width - a.b.width || a.object.id - b.object.id,
    ),
    [...entries].sort(
      (a, b) => b.b.width - a.b.width || b.b.depth - a.b.depth || a.object.id - b.object.id,
    ),
  ];
  // Also try grouping filaments first: dense single-filament plates can use
  // fewer beds than a mixed layout that needs toolhead clearance everywhere.
  orders.push(...orders.map(order => [...order].sort((a, b) => slot(a.object) - slot(b.object))));
  let best: Packed[][] | undefined;
  for (const order of orders) {
    const plates: Packed[][] = [];
    for (const entry of order) {
      let placed = false;
      for (let index = 0; index <= plates.length; index++) {
        const plate = plates[index] ?? [];
        const sequential = mixed([entry, ...plate]);
        // A single tall object may print last; two tall objects cannot share a
        // plate without printer-specific gantry/order analysis.
        if (
          sequential &&
          [entry, ...plate].filter(p => p.b.height > printer.rodHeightMm).length > 1
        )
          continue;
        const short = [entry, ...plate].every(p => p.b.height < printer.nozzleHeightMm - 1.5);
        const gap = (sequential ? (short ? 4 : printer.clearanceMm) : 2) + 6; // two 3 mm brims
        const xs = [
          ...new Set([
            margin,
            printer.excludedBedMm[0] + margin,
            ...plate.map(p => p.x + p.b.width + gap),
          ]),
        ].sort((a, b) => a - b);
        const ys = [
          ...new Set([
            margin,
            printer.excludedBedMm[1] + margin,
            ...plate.map(p => p.y + p.b.depth + gap),
          ]),
        ].sort((a, b) => a - b);
        // Adding another filament or a taller object changes the clearance tier
        // for the whole plate. Recheck every existing pair before accepting it.
        const separated = (a: Packed, b: Packed) =>
          a.x + a.b.width + gap <= b.x ||
          b.x + b.b.width + gap <= a.x ||
          a.y + a.b.depth + gap <= b.y ||
          b.y + b.b.depth + gap <= a.y;
        if (plate.some((p, i) => plate.slice(i + 1).some(q => !separated(p, q)))) continue;
        for (const y of ys) {
          for (const x of xs) {
            const candidate = { ...entry, x, y };
            if (
              x + entry.b.width > printer.bedMm - margin ||
              y + entry.b.depth > printer.bedMm - margin
            )
              continue;
            if (x < printer.excludedBedMm[0] + margin && y < printer.excludedBedMm[1] + margin)
              continue;
            if (!plate.every(p => separated(p, candidate))) continue;
            if (!plates[index]) plates.push(plate);
            plate.push(candidate);
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (placed) break;
        if (index === plates.length)
          throw new Error(
            `"${entry.object.name}" does not fit outside ${printer.name}'s excluded bed area.`,
          );
      }
    }
    if (!best || plates.length < best.length) best = plates;
  }
  if (singlePlate && best!.length !== 1)
    throw new Error(
      'The fit test does not fit on one plate with sequential-print spacing. Choose a larger printer.',
    );
  if (best!.length > 36)
    throw new Error(
      'This export exceeds Bambu Studio’s 36-plate limit. Reduce the number of parts.',
    );
  const columns = Math.ceil(Math.sqrt(best!.length));
  return best!.flatMap((plate, index) =>
    // Native sequential order follows resource order. Short objects first keeps
    // the rod clear; the one object above rod/lid height is always last.
    plate
      .sort((a, b) => a.b.height - b.b.height || a.object.id - b.object.id)
      .map(({ object, b, x, y }) => ({
        object,
        plate: index + 1,
        printSequence: mixed(plate) ? ('by object' as const) : ('by layer' as const),
        translation: [
          x - b.min[0] + (index % columns) * printer.bedMm * 1.2,
          y - b.min[1] - Math.floor(index / columns) * printer.bedMm * 1.2,
          -b.min[2],
        ] as [number, number, number],
      })),
  );
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
        meshXml(object.mesh, project, object.faceMaterials, 'prusa') +
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
    return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${coreNamespace}" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="Application">PrusaSlicer-2.9.0</metadata><metadata name="Designer">Contour Workbench</metadata><metadata name="slic3rpe:Version3mf">1</metadata><resources><basematerials id="${materialId}">${baseMaterialsXml(project)}</basematerials>${meshObjects}</resources><build>${build}</build></model>`;
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
    '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"><metadata name="Application">PrusaSlicer-2.9.0</metadata><metadata name="Designer">Contour Workbench</metadata><metadata name="slic3rpe:Version3mf">1</metadata><metadata name="Title">' +
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
        `<object id="${object.id}" name="${xmlEscape(object.name)}" type="model" pid="${materialId}" pindex="${kind === 'shapeways' ? 0 : materialIndex(project, object)}">${meshXml(object.mesh, project, object.faceMaterials, kind, materialId)}</object>`,
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
  // Bambu gates native project import on this Application prefix (bbs_3mf.cpp).
  // Designer and the embedded manifest retain Contour Workbench provenance.
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
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${coreNamespace}" xmlns:BambuStudio="${bambuNamespace}" xmlns:p="${productionNamespace}" requiredextensions="p"><metadata name="Application">BambuStudio-2.0.0</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><metadata name="Title">${title}</metadata><metadata name="Designer">Contour Workbench</metadata><metadata name="Description">Bambu Studio multipart terrain project</metadata><resources>${resourceXml}</resources><build p:UUID="${bambuBuildUuid}">${buildXml}</build></model>`;
}

function bambuChildModel(project: Project, object: ObjectRecord) {
  const childId = object.id * 2 - 1;
  const materialId = childId + 1;
  const objectUuid = bambuPartUuid(object.id, '-81cb-4c03-9d28-80fed5dfa1dc');
  const group = projectMaterialGroups(project)[materialIndex(project, object)];
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${coreNamespace}" xmlns:BambuStudio="${bambuNamespace}" xmlns:p="${productionNamespace}" requiredextensions="p"><metadata name="BambuStudio:3mfVersion">1</metadata><resources><basematerials id="${materialId}"><base name="${xmlEscape(group.name)}" displaycolor="${group.color.toUpperCase()}FF"/></basematerials><object id="${childId}" name="${xmlEscape(object.name)}" p:UUID="${objectUuid}" type="model" pid="${materialId}" pindex="0">${meshXml(object.mesh, project, object.faceMaterials, 'bambu')}</object></resources><build/></model>`;
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
        `<plate><metadata key="plater_id" value="${plate}"/><metadata key="plater_name" value="${'Plate ' + plate}"/><metadata key="locked" value="false"/><metadata key="print_sequence" value="${items[0].printSequence ?? 'by layer'}"/>${items.map(item => `<model_instance><metadata key="object_id" value="${item.object.id * 2}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${item.object.id}"/></model_instance>`).join('')}</plate>`,
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

// Prusa reads object/volume assignments from this sidecar, not mesh metadata.
function prusaModelSettings(project: Project, objects: ObjectRecord[]) {
  const groups = projectMaterialGroups(project);
  const separate = project.settings.manufacturing_mode === 'separate';
  const sets = separate ? objects.map(object => [object]) : [objects];
  return `<?xml version="1.0" encoding="UTF-8"?><config>${sets
    .map(parts => {
      let first = 0;
      const volumes = parts
        .map(object => {
          const last = first + object.mesh.indices.length / 3 - 1;
          const volume = `<volume firstid="${first}" lastid="${last}"><metadata type="volume" key="name" value="${xmlEscape(object.name)}"/><metadata type="volume" key="extruder" value="${groups[materialIndex(project, object)].extruder}"/></volume>`;
          first = last + 1;
          return volume;
        })
        .join('');
      const id = separate ? parts[0].id : objects.length + 1;
      return `<object id="${id}" instances_count="1">${volumes}</object>`;
    })
    .join('')}</config>`;
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
  options: ThreeMfOptions = {},
): Uint8Array {
  if (asset.faceMaterials) project = { ...project, materials: filamentPlan(project).groups };
  let objects = records(asset);
  if (
    (kind === 'bambu' || kind === 'prusa') &&
    !asset.faceMaterials &&
    project.settings.manufacturing_mode === 'separate'
  )
    project = { ...project, materials: separateFilamentGroups(project, objects) };
  const printerId = options.bambuPrinter ?? 'p1s';
  const separateParts = kind === 'bambu' && project.settings.manufacturing_mode === 'separate';
  if (
    asset.faceMaterials &&
    (asset.inserts.length || asset.faceMaterials.length !== asset.terrain.indices.length / 3)
  )
    throw new Error('Painted export must contain one exterior mesh and one material per triangle.');
  for (const object of objects) validateThreeMfMesh(object.mesh, object.name);
  const placements =
    project.settings.manufacturing_mode === 'multicolor' || kind === 'shapeways'
      ? assembledPlacement(objects)
      : kind === 'bambu'
        ? packedPlacement(objects, project, printerId, !!options.sequentialSinglePlate)
        : separatePlacement(objects);
  if (separateParts) {
    placements.forEach((p, index) => {
      p.object = { ...p.object, id: index + 1 };
    });
    objects = placements.map(p => p.object);
  }
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
          bed_size_mm:
            kind === 'bambu'
              ? [bambuPrinter(printerId).bedMm, bambuPrinter(printerId).bedMm]
              : project.settings.max_print_size_mm,
          ...(kind === 'bambu' ? { printer: printerId, print_sequence: 'by layer' } : {}),
          plates: [...new Set(placements.map(item => item.plate))].map(plate => ({
            plate,
            ...(kind === 'bambu'
              ? {
                  print_sequence:
                    placements.find(p => p.plate === plate)!.printSequence ?? 'by layer',
                }
              : {}),
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
      JSON.stringify(
        bambuProjectSettings(asset, project, objects, printerId, separateParts),
        null,
        2,
      ),
    );
    files['Metadata/model_settings.config'] = strToU8(modelSettings(project, objects, placements));
    files['Metadata/layer_heights_profile.txt'] = strToU8(
      bambuLayerHeightProfiles(placements, project.settings.nozzle_diameter_mm),
    );
  } else if (kind === 'prusa') {
    const palette = exportFilamentColors(asset, project, objects);
    files['Metadata/Slic3r_PE.config'] = strToU8(
      prusaPrintConfig(project) +
        `; extruder_colour = ${palette.join(';')}\n; filament_colour = ${palette.join(';')}\n` +
        `; nozzle_diameter = ${palette.map(() => project.settings.nozzle_diameter_mm).join(',')}\n`,
    );
    files['Metadata/Slic3r_PE_model.config'] = strToU8(prusaModelSettings(project, objects));
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

function paintedFilamentSettings(asset: Asset, project: Project) {
  if (!asset.faceMaterials) return {};
  const groups = projectMaterialGroups(project);
  const used = [...new Set(asset.faceMaterials)].map(index =>
    groups.find(group => group.id === surfaceMaterials[index])!,
  );
  const count = Math.max(...used.map(group => group.extruder));
  return {
    filament_colour: Array.from(
      { length: count },
      (_, index) =>
        used.find(group => group.extruder === index + 1)?.color.toUpperCase() ?? '#FFFFFF',
    ),
  };
}

function exportFilamentColors(asset: Asset, project: Project, objects: ObjectRecord[]) {
  const groups = projectMaterialGroups(project);
  const slots = Math.max(...objects.map(o => groups[materialIndex(project, o)].extruder));
  return (
    paintedFilamentSettings(asset, project).filament_colour ??
    Array.from(
      { length: slots },
      (_, i) =>
        objects
          .map(o => groups[materialIndex(project, o)])
          .find(g => g.extruder === i + 1)
          ?.color.toUpperCase() ??
        groups.find(g => g.extruder === i + 1)?.color.toUpperCase() ??
        '#FFFFFF',
    )
  );
}

function bambuProjectSettings(
  asset: Asset,
  project: Project,
  objects: ObjectRecord[],
  printerId: BambuPrinterId,
  separateParts: boolean,
) {
  const printer = bambuPrinter(printerId);
  const nozzle = project.settings.nozzle_diameter_mm;
  if (![0.2, 0.4, 0.6, 0.8].includes(nozzle))
    throw new Error('Bambu exports support 0.2, 0.4, 0.6, and 0.8 mm nozzles.');
  const family = printerId === 'a1' ? 'A1' : printerId === 'a1-mini' ? 'A1M' : 'X1C';
  const printId = `${(nozzle / 2).toFixed(2)}mm Standard @BBL ${family}${nozzle === 0.4 ? '' : ` ${nozzle} nozzle`}`;
  const machineId = `${printer.name} ${nozzle} nozzle`;
  const filamentId = `Bambu PLA Basic @BBL ${printerId === 'p1s' && (nozzle === 0.4 || nozzle === 0.6) ? `P1S ${nozzle} nozzle` : family + (nozzle === 0.2 || (family === 'X1C' && nozzle !== 0.4) ? ` ${nozzle} nozzle` : '')}`;
  const colors = exportFilamentColors(asset, project, objects);
  const overrides = {
    ...bambuProcessSettings(project),
    ...(separateParts
      ? { print_sequence: 'by layer', brim_width: '3', skirt_loops: '0' }
      : { print_sequence: 'by layer' }),
  };
  // 2.5 dereferences filament_colour before backfilling defaults. Preset IDs
  // plus an explicit difference list make omitted values inherit the installed
  // machine/process/filament presets, rather than generic FullPrintConfig values.
  return {
    ...overrides,
    printer_model: printer.name,
    printer_variant: String(nozzle),
    printer_settings_id: machineId,
    print_settings_id: printId,
    filament_settings_id: colors.map(() => filamentId),
    filament_colour: colors,
    nozzle_diameter: [String(nozzle)],
    printable_area: [
      '0x0',
      `${printer.bedMm}x0`,
      `${printer.bedMm}x${printer.bedMm}`,
      `0x${printer.bedMm}`,
    ],
    inherits_group: [printId, ...colors.map(() => filamentId), machineId],
    different_settings_to_system: [
      Object.keys(overrides).join(';'),
      ...colors.map(() => 'filament_colour'),
      '',
    ],
  };
}

/** Structural validation for generated 3MF OPC packages. */
import { strFromU8 } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import type { Mesh } from './types';

/** Check mesh cardinality, finite coordinates, and index bounds before XML serialization. */
export function validateThreeMfMesh(mesh: Mesh, label: string) {
  if (!mesh.positions.length || mesh.positions.length % 3)
    throw new Error(`${label} has an invalid vertex array.`);
  if (!mesh.indices.length || mesh.indices.length % 3)
    throw new Error(`${label} has an invalid triangle array.`);
  if (Array.from(mesh.positions).some(value => !Number.isFinite(Number(value))))
    throw new Error(`${label} contains a non-finite coordinate.`);
  const vertexCount = mesh.positions.length / 3;
  if (
    Array.from(mesh.indices).some(
      value =>
        !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) >= vertexCount,
    )
  )
    throw new Error(`${label} contains an out-of-range triangle index.`);
}

function decode(files: Record<string, Uint8Array>, name: string) {
  const file = files[name];
  if (!file) throw new Error(`3MF package is missing ${name}.`);
  return strFromU8(file);
}

function validXml(name: string, xml: string) {
  const result = XMLValidator.validate(xml);
  if (result !== true)
    throw new Error(
      `${name} is not well-formed XML: ${result.err.msg} at line ${result.err.line}.`,
    );
}

function validLayerHeightProfiles(name: string, profile: string, expectedObjectIds: number[]) {
  const lines = profile.trim().split(/\r?\n/);
  const seen = new Set<number>();
  let valid = lines.length === expectedObjectIds.length;
  for (const line of lines) {
    const match = line.match(/^object_id=(\d+)\|(.+)$/);
    const objectId = Number(match?.[1]);
    const values = match?.[2].split(';').map(Number) || [];
    valid &&= expectedObjectIds.includes(objectId) && !seen.has(objectId);
    valid &&=
      values.length >= 4 &&
      values.length % 2 === 0 &&
      values.every(value => Number.isFinite(value)) &&
      values.every((value, index) => index % 2 === 0 || value >= 0.04);
    for (let index = 2; index < values.length; index += 2)
      valid &&= values[index] >= values[index - 2];
    seen.add(objectId);
  }
  valid &&= expectedObjectIds.every(objectId => seen.has(objectId));
  if (!valid) throw new Error(`${name} has an invalid adaptive layer height profile.`);
}

/** Validate required OPC parts, XML syntax, namespaces, object IDs, and build references. */
export function validateThreeMfFiles(
  files: Record<string, Uint8Array>,
  kind: 'portable' | 'bambu' | 'prusa' | 'shapeways',
) {
  const contentTypes = decode(files, '[Content_Types].xml');
  const relationships = decode(files, '_rels/.rels');
  const model = decode(files, '3D/3dmodel.model');
  validXml('[Content_Types].xml', contentTypes);
  validXml('_rels/.rels', relationships);
  validXml('3D/3dmodel.model', model);
  if (!contentTypes.includes('3dmanufacturing-3dmodel+xml'))
    throw new Error('3MF content types do not declare a model part.');
  if (!relationships.includes('Target="/3D/3dmodel.model"'))
    throw new Error('3MF relationships do not point to the model part.');
  if (
    !model.includes('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"') ||
    !model.includes('unit="millimeter"')
  )
    throw new Error('3MF model is missing the core namespace or millimeter units.');

  const objectIds = [...model.matchAll(/<object\b[^>]*\bid="(\d+)"/g)].map(match => match[1]);
  if (!objectIds.length || new Set(objectIds).size !== objectIds.length)
    throw new Error('3MF object identifiers are empty or duplicated.');
  const known = new Set(objectIds);
  const buildReferences = [...model.matchAll(/<item\b[^>]*\bobjectid="(\d+)"/g)].map(
    match => match[1],
  );
  const componentReferences = [...model.matchAll(/<component\b[^>]*\bobjectid="(\d+)"/g)].map(
    match => match[1],
  );
  if (
    !buildReferences.length ||
    buildReferences.some(id => !known.has(id)) ||
    (kind !== 'bambu' && componentReferences.some(id => !known.has(id)))
  )
    throw new Error('3MF build or component references an unknown object.');

  if (kind === 'bambu') {
    if (
      !model.includes('xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"') ||
      !model.includes(
        'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"',
      ) ||
      !model.includes('requiredextensions="p"') ||
      !model.includes('<metadata name="BambuStudio:3mfVersion">1</metadata>')
    )
      throw new Error('Bambu 3MF model is missing Bambu Studio project metadata.');

    const modelRelationships = decode(files, '3D/_rels/3dmodel.model.rels');
    validXml('3D/_rels/3dmodel.model.rels', modelRelationships);
    const componentPaths = [
      ...model.matchAll(/<component\b[^>]*\bp:path="\/(3D\/Objects\/[^"]+\.model)"/g),
    ].map(match => match[1]);
    if (!componentPaths.length || new Set(componentPaths).size !== objectIds.length)
      throw new Error('Bambu 3MF model has missing or duplicated child model references.');
    for (const path of componentPaths) {
      const childModel = decode(files, path);
      validXml(path, childModel);
      if (!childModel.includes('<mesh>') || !childModel.includes('<build/>'))
        throw new Error(`${path} is not a Bambu child mesh model.`);
      if (!modelRelationships.includes(`Target="/${path}"`))
        throw new Error(`Bambu relationships do not reference ${path}.`);
    }

    const modelSettings = decode(files, 'Metadata/model_settings.config');
    validXml('Metadata/model_settings.config', modelSettings);
    if (modelSettings.includes('<assemble_item'))
      throw new Error('Bambu model settings duplicate build placement transforms.');
    JSON.parse(decode(files, 'Metadata/project_settings.config'));
    validLayerHeightProfiles(
      'Bambu 3MF',
      decode(files, 'Metadata/layer_heights_profile.txt'),
      objectIds.map((_, index) => index + 1),
    );
  }
  if (kind === 'prusa') {
    if (
      !model.includes('xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"') ||
      !model.includes('<metadata name="slic3rpe:Version3mf">1</metadata>')
    )
      throw new Error('Prusa 3MF model is missing PrusaSlicer project metadata.');
    const printConfig = decode(files, 'Metadata/Slic3r_PE.config');
    if (!printConfig.includes('; variable_layer_height = 1'))
      throw new Error('Prusa 3MF does not enable variable layer height.');
    validLayerHeightProfiles(
      'Prusa 3MF',
      decode(files, 'Metadata/Slic3r_PE_layer_heights_profile.txt'),
      [1],
    );
  }
  JSON.parse(decode(files, 'Metadata/project.contour.json'));
  JSON.parse(decode(files, 'Metadata/contour_workbench.json'));
}

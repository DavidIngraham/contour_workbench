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
    [...buildReferences, ...componentReferences].some(id => !known.has(id))
  )
    throw new Error('3MF build or component references an unknown object.');

  if (kind === 'bambu') {
    const modelSettings = decode(files, 'Metadata/model_settings.config');
    validXml('Metadata/model_settings.config', modelSettings);
    JSON.parse(decode(files, 'Metadata/project_settings.config'));
  }
  JSON.parse(decode(files, 'Metadata/project.contour.json'));
  JSON.parse(decode(files, 'Metadata/contour_workbench.json'));
}

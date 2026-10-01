import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {roundPolygon} from '../src/extent-shapes';
import {overlayFeatureId} from '../src/presets';

describe('Mt. Hood Meadows preset',()=>{
 it('preserves the rectangular footprint and rounds its corners by 1,000 m',()=>{
  const path=fileURLToPath(new URL('../public/examples/presets/mt-hood-meadows.cwpack',import.meta.url));
  const files=unzipSync(readFileSync(path));
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  const project=manifest.project;
  expect(project.extent_editor.shape).toBe('freeform');
  expect(project.extent_editor.points).toEqual([
   [-121.704,45.296],[-121.622,45.296],[-121.622,45.374],[-121.704,45.374]
  ]);
  expect(project.extent_editor.corner_radius_m).toBe(1000);
  const expected=roundPolygon(project.extent_editor.points,1000);
  expect(project.settings.boundary).toHaveLength(40);
  project.settings.boundary.forEach((point:[number,number],index:number)=>{
   expect(point[0]).toBeCloseTo(expected[index][0],10);
   expect(point[1]).toBeCloseTo(expected[index][1],10);
  });
  const featureIds=new Set(project.features.map((feature:{id:string})=>feature.id));
  expect(manifest.overlays.every((overlay:{id:string})=>featureIds.has(overlayFeatureId(overlay.id)))).toBe(true);
 });
});

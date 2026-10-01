import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it} from 'vitest';
import {overlayFeatureId} from '../src/presets';

describe('Mt. Hood Meadows preset',()=>{
 it('uses an exact 1,000 m circular extent with linked overlays',()=>{
  const path=fileURLToPath(new URL('../public/examples/presets/mt-hood-meadows.cwpack',import.meta.url));
  const files=unzipSync(readFileSync(path));
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  const project=manifest.project,center=project.extent_editor.center;
  expect(project.extent_editor.shape).toBe('circle');
  expect(project.extent_editor.width_m/2).toBe(1000);
  expect(project.settings.boundary).toHaveLength(96);
  const xScale=111319.490793*Math.cos(center[1]*Math.PI/180);
  for(const [longitude,latitude] of project.settings.boundary){
   const radius=Math.hypot((longitude-center[0])*xScale,(latitude-center[1])*111319.490793);
   expect(radius).toBeCloseTo(1000,6);
  }
  const featureIds=new Set(project.features.map((feature:{id:string})=>feature.id));
  expect(manifest.overlays.every((overlay:{id:string})=>featureIds.has(overlayFeatureId(overlay.id)))).toBe(true);
 });
});


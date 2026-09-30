import {describe,expect,it} from 'vitest';
import {calibrationClearances,extrusionWidthMm,fitProfile,insetAtHeight,recommendedInsertWidthMm} from '../src/insert-fit';
import {defaults} from '../src/types';

describe('nozzle-aware insert fit',()=>{
 it('uses a 0.4 mm nozzle and two extrusion widths for new projects',()=>{
  expect(defaults.nozzle_diameter_mm).toBe(.4);
  expect(extrusionWidthMm(defaults.nozzle_diameter_mm)).toBeCloseTo(.45);
  expect(defaults.path_width_mm).toBe(.9);
  expect(recommendedInsertWidthMm(.4)).toBeCloseTo(.9);
 });
 it('keeps the bottom of a narrow line at least one extrusion wide',()=>{
  const profile=fitProfile(defaults,'trail',defaults.insert_depth_mm);
  expect(defaults.path_width_mm-2*insetAtHeight(profile,0)).toBeCloseTo(profile.extrusionWidthMm);
  const legacy={...defaults,nozzle_diameter_mm:.6,path_width_mm:.8},p=fitProfile(legacy,'trail',legacy.insert_depth_mm);
  expect(legacy.path_width_mm-2*insetAtHeight(p,0)).toBeGreaterThanOrEqual(p.extrusionWidthMm-1e-8);
 });
 it('builds four useful calibration clearances around the selected fit',()=>{expect(calibrationClearances(defaults)).toEqual([.1,.15,.2,.25]);});
});

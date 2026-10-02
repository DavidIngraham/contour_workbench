import {describe,expect,it} from 'vitest';
import {calibrationSwitchbackCenterlineMm as path} from '../src/calibration-path';

describe('calibration switchback path',()=>{
 it('contains alternating close runs, hairpins, and an angled jog',()=>{
  const segments=path.slice(1).map(([x,y],index)=>{const [px,py]=path[index];return {dx:x-px,dy:y-py};});
  const horizontal=segments.filter(({dy})=>Math.abs(dy)<1e-9).map(({dx})=>Math.sign(dx));
  expect(horizontal).toEqual([1,-1,1,-1,1]);
  expect(segments.filter(({dx})=>Math.abs(dx)<1e-9)).toHaveLength(3);
  expect(segments.some(({dx,dy})=>Math.abs(dx)>0&&Math.abs(dy)>0)).toBe(true);
  const xs=path.map(([x])=>x),ys=path.map(([,y])=>y);
  expect(Math.max(...xs)-Math.min(...xs)).toBeLessThanOrEqual(14);
  expect(Math.max(...ys)-Math.min(...ys)).toBeLessThanOrEqual(11);
 });
});

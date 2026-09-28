import {describe,it,expect} from 'vitest';
import {checkBounds} from '../src/providers';
describe('supported geographic areas',()=>{
 it('accepts a small US area',()=>expect(()=>checkBounds([-121.68,45.65,-121.62,45.70])).not.toThrow());
 it.each([[1,2,0,3],[-181,0,-180,1],[0,85,1,86],[0,0,3,1],[0,0,NaN,1]])('rejects invalid bounds %s',(...b)=>expect(()=>checkBounds(b as [number,number,number,number])).toThrow());
});

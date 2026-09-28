import {describe,it,expect} from 'vitest';
import {automaticProduct,sourceSampleCount} from '../src/source-resolution';
describe('area-aware elevation source',()=>{
 it('preserves 10 m for small US areas',()=>expect(automaticProduct([-121.65,45.65,-121.6,45.7])).toBe('usgs_3dep_10m'));
 it('uses 30 m for medium US areas',()=>expect(automaticProduct([-122,45,-121.8,45.2])).toBe('usgs_3dep_30m'));
 it('uses 90 m for giant areas',()=>expect(automaticProduct([-122,45,-120.5,46.5])).toBe('copernicus_glo90'));
 it('uses global data internationally',()=>expect(automaticProduct([10,45,10.1,45.1])).toBe('copernicus_glo30'));
 it('counts raster allocation conservatively',()=>expect(sourceSampleCount([0,0,1,1],90)).toBe(1203*1203));
});


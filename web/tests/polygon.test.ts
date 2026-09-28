import {describe,it,expect} from 'vitest';
import {polygonBounds,validatePolygon} from '../src/polygon';
describe('polygon extent',()=>{
 it('accepts concave outlines in either winding',()=>{const p:[number,number][]=[[0,0],[1,0],[.4,.4],[1,1],[0,1]];expect(()=>validatePolygon(p)).not.toThrow();expect(()=>validatePolygon(p.reverse())).not.toThrow();expect(polygonBounds(p)).toEqual([0,0,1,1]);});
 it('rejects crossing edges',()=>expect(()=>validatePolygon([[0,0],[1,1],[0,1],[1,0]])).toThrow());
 it('rejects degenerate and repeated vertices',()=>{expect(()=>validatePolygon([[0,0],[.5,.5],[1,1]])).toThrow();expect(()=>validatePolygon([[0,0],[1,0],[1,0],[0,1]])).toThrow();});
 it('rejects unsupported extent',()=>expect(()=>validatePolygon([[0,0],[4,0],[0,1]])).toThrow());
});

import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validatePolygon} from '../src/polygon';
it('opens the exact original Post Canyon polygon with complete elevation coverage',()=>{
 const data=JSON.parse(readFileSync(new URL('../public/examples/post-canyon.json',import.meta.url),'utf8'));
 const features:any[]=[];function scan(v:any){if(!v||typeof v!=='object')return;if(v.type==='Feature'&&v.properties?.id==='boundary')features.push(v);else Object.values(v).forEach(scan);}scan(data.geojson);
 expect(data.boundary).toEqual(features[0].geometry.coordinates[0].slice(0,-1));expect(()=>validatePolygon(data.boundary)).not.toThrow();
 const [w,s,e,n]=data.grid.bounds;expect(data.boundary.every(([x,y]:number[])=>x>=w&&x<=e&&y>=s&&y<=n)).toBe(true);
});

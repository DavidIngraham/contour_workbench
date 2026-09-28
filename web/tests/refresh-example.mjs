import fs from 'node:fs';
import {chromium} from '@playwright/test';
const path='public/examples/post-canyon.json';const example=JSON.parse(fs.readFileSync(path,'utf8'));
const polygons=[];function scan(v){if(!v||typeof v!=='object')return;if(v.type==='Feature'&&v.properties?.id==='boundary'&&v.geometry?.type==='Polygon')polygons.push(v);else for(const value of Object.values(v))if(typeof value==='object')scan(value);}scan(example.geojson);
if(polygons.length!==1)throw new Error('Expected exactly one original boundary');
const boundary=polygons[0].geometry.coordinates[0].map(p=>p.slice(0,2));if(JSON.stringify(boundary[0])===JSON.stringify(boundary.at(-1)))boundary.pop();
const bounds=[Math.min(...boundary.map(p=>p[0])),Math.min(...boundary.map(p=>p[1])),Math.max(...boundary.map(p=>p[0])),Math.max(...boundary.map(p=>p[1]))];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto('http://localhost:5173');const data=await page.evaluate(async bounds=>{const {loadElevation}=await import('/src/providers.ts');return loadElevation(bounds,'usgs_3dep_10m',async()=>[],()=>{},new AbortController().signal);},bounds);example.grid=data.grid;example.source={...data.source,bundled:true};example.boundary=boundary;fs.writeFileSync(path,JSON.stringify(example));console.log('Preserved original polygon:',boundary,'Elevation samples:',data.grid.width*data.grid.height);}finally{await browser.close();}

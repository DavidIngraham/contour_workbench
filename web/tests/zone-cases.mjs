
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const defaults={
 max_print_size_mm:[180,160],height_factor:1,base_height_mm:2,path_width_mm:1,path_clearance_mm:.15,
 insert_depth_mm:2,zone_insert_depth_mm:.8,zone_floor_mm:.8,ski_run_width_m:35,carve_depth_mm:.45,
 insert_gap_mm:.35,insert_segment_size_mm:null,terrain_max_error_mm:0,boundary:[]
};
function project(name,bounds,features,winter=false){
 const width=25,height=25,elevations=[];
 for(let j=0;j<height;j++)for(let i=0;i<width;i++){
  const x=i/(width-1)-.5,y=j/(height-1)-.5;
  elevations.push(1000+90*Math.exp(-(x*x+y*y)*8)+18*x+10*Math.sin(i*.45)*Math.cos(j*.35));
 }
 const [w,s,e,n]=bounds;
 return {schema_version:2,name,winter_mode:winter,grid:{bounds,width,height,elevations},
  source:{product:'test',name:'Regression terrain',retrieved:'2026-09-30T00:00:00Z',attribution:'Synthetic regression fixture'},
  features,settings:{...defaults,boundary:[[w,s],[e,s],[e,n],[w,n]]}};
}
const ring=(b,points)=>points.map(([u,v])=>[b[0]+u*(b[2]-b[0]),b[1]+v*(b[3]-b[1])]);
const area=(id,name,cls,b,points,holes=[],surface='terrain')=>({id,name,class:cls,lines:[],polygons:[{outer:ring(b,points),holes:holes.map(h=>ring(b,h))}],enabled:true,treatment:'insert',surface,tags:{}});
const line=(id,name,cls,b,points,treatment='insert',width_m)=>({id,name,class:cls,lines:[ring(b,points)],polygons:[],enabled:true,treatment,surface:'terrain',width_m,tags:{}});
const closed=[[.18,.18],[.82,.18],[.9,.48],[.72,.82],[.25,.78],[.12,.45],[.18,.18]];
const island=[[.46,.43],[.56,.43],[.58,.54],[.47,.57],[.46,.43]];
const cases=[
 {slug:'kingsley-reservoir',name:'Kingsley Reservoir',bounds:[-121.695,45.69,-121.665,45.72],features:b=>[
  area('water:kingsley','Kingsley Reservoir','water',b,closed,[island],'level'),
  line('trail:shore','Reservoir Trail','trail',b,[[.12,.3],[.35,.62],[.76,.72]])
 ]},
 {slug:'columbia-boundary',name:'Columbia River Boundary',bounds:[-121.60,45.66,-121.54,45.72],features:b=>[
  area('water:columbia','Columbia River','water',b,[[.58,-.15],[1.18,-.15],[1.18,1.15],[.7,1.15],[.56,.62],[.58,-.15]],[],'level'),
  line('trail:ridge','Boundary Ridge','trail',b,[[.12,.2],[.38,.44],[.55,.78]])
 ]},
 {slug:'mount-hood-winter',name:'Mount Hood Winter',winter:true,bounds:[-121.74,45.31,-121.64,45.39],features:b=>[
  area('glacier:palmer','Palmer Glacier','glacier',b,[[.38,.52],[.58,.54],[.65,.82],[.48,.9],[.33,.72],[.38,.52]]),
  area('piste:area','White River Run','ski_run',b,[[.15,.12],[.31,.16],[.51,.61],[.43,.66],[.15,.12]]),
  line('piste:center','Timberline Run','ski_run',b,[[.72,.18],[.63,.38],[.69,.58],[.58,.82]],'insert',45),
  line('lift:chair','Magic Mile Chair','ski_lift',b,[[.24,.16],[.35,.42],[.46,.68],[.52,.88]],'v_carve')
 ]}
];

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(process.env.APP_URL||'http://localhost:5173');
 await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:240000});
 if(await page.locator('#topo-map.active').count())await page.locator('#topo-map').click();
 for(const test of (process.env.CASE?cases.filter(c=>c.slug.includes(process.env.CASE)):cases)){
  const data=project(test.name,test.bounds,test.features(test.bounds),Boolean(test.winter));
  await page.locator('#file-project').setInputFiles({name:test.slug+'.contour.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.waitForFunction(name=>document.querySelector('#location-name')?.textContent===name&&!window.contourDiagnostics.busy,test.name,{timeout:240000});
  assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());
  await page.getByRole('button',{name:/Features/}).click();
  const row=page.locator('[data-feature]').filter({hasText:data.features[0].name}).first();
  await row.locator('.feature-item>span').click();
  await page.locator('#generate').click();
  for(let i=0;i<12&&await page.evaluate(()=>window.contourDiagnostics.busy);i++){await page.waitForTimeout(5000);console.log('PROGRESS',test.slug,await page.locator('#status').innerText());}
  await page.waitForFunction(()=>!window.contourDiagnostics.busy&&(window.contourDiagnostics?.asset||document.querySelector('#status.error')),null,{timeout:240000});
  assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());
  const validation=await page.evaluate(()=>window.contourDiagnostics.asset);
  assert.equal(validation.watertight,true);
  assert.ok(validation.pieces>=1);
  await page.locator('#mode-design').click();
  await page.getByRole('button',{name:/Features/}).click();
  await row.locator('.feature-item>span').click();
  await page.screenshot({path:'../temp/zone-cases/'+test.slug+'.png',fullPage:true});
  console.log('PASS',test.slug,validation);
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}

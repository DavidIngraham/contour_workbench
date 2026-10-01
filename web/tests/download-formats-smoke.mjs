import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {strFromU8,unzipSync} from 'fflate';

const bounds=[-121.67,45.68,-121.66,45.69],width=12,height=12,elevations=[];
for(let y=0;y<height;y++)for(let x=0;x<width;x++)elevations.push(1000+x*2+y+8*Math.sin(x*.4)*Math.cos(y*.3));
const project={schema_version:2,name:'Mobile Export Test',grid:{bounds,width,height,elevations},source:{product:'test',name:'Synthetic',retrieved:'2026-10-01',attribution:'Synthetic test'},features:[],settings:{
 max_print_size_mm:[180,160],height_factor:1,base_height_mm:2,path_width_mm:1,path_clearance_mm:.15,nozzle_diameter_mm:.4,insert_fit_clearance_per_side_mm:.15,insert_elephant_foot_relief_mm:.18,insert_elephant_foot_height_mm:.4,insert_draft_angle_deg:1.5,insert_depth_mm:2,zone_insert_depth_mm:.8,zone_floor_mm:.8,ski_run_width_m:35,carve_depth_mm:.45,insert_gap_mm:.35,insert_segment_size_mm:null,terrain_max_error_mm:0,boundary:[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]]
}};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
try{
 await page.goto(process.env.APP_URL||'http://localhost:5173');
 await page.locator('#file-project').setInputFiles({name:'mobile-export.contour.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:120000});
 await page.locator('#generate').click();
 await page.waitForFunction(()=>window.contourDiagnostics?.asset?.watertight&&!window.contourDiagnostics.busy,null,{timeout:120000});
 await page.locator('#download').click();
 assert.equal(await page.locator('.format-option').count(),3);
 assert.match(await page.locator('#bambu-export-note').innerText(),/0\.20 mm layers/);
 const box=await page.locator('.download-modal').boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=390.5&&box.y+box.height<=844.5);
 await page.locator('input[value=portable]').check();
 let pending=page.waitForEvent('download');await page.locator('#download-confirm').click();let downloaded=await pending;
 assert.equal(downloaded.suggestedFilename(),'Mobile Export Test.3mf');
 let files=unzipSync(new Uint8Array(await downloaded.createReadStream().then(async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);})));
 assert.ok(files['3D/3dmodel.model']);assert.equal(files['Metadata/project_settings.config'],undefined);
 await page.locator('#download').click();await page.locator('input[value=bambu]').check();
 pending=page.waitForEvent('download');await page.locator('#download-confirm').click();downloaded=await pending;
 assert.equal(downloaded.suggestedFilename(),'Mobile Export Test-bambu.3mf');
 files=unzipSync(new Uint8Array(await downloaded.createReadStream().then(async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);})));
 assert.equal(JSON.parse(strFromU8(files['Metadata/project_settings.config'])).layer_height,'0.20');
 assert.ok(files['Metadata/model_settings.config']);
 console.log('PASS download chooser, portable 3MF, Bambu 3MF, and mobile fit');
}finally{await browser.close();}

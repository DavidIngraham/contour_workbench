import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {strFromU8,unzipSync} from 'fflate';

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:900}});
try{
 await page.goto(process.env.APP_URL||'http://localhost:5173');
 await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:240000});
 await page.getByRole('button',{name:'Print setup',exact:true}).click();
 assert.equal(await page.locator('#nozzle-diameter').inputValue(),'0.4');
 const pending=page.waitForEvent('download');
 await page.locator('#download-calibration').click();
 const download=await pending;
 await mkdir('../temp',{recursive:true});
 const path='../temp/contour-fit-test.zip';
 await download.saveAs(path);
 await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:240000});
 assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());
 const files=unzipSync(new Uint8Array(await readFile(path)));
 const names=Object.keys(files).sort();
 assert.ok(names.includes('coupon-base.stl'));
 assert.equal(names.filter(name=>name.startsWith('insert-')&&name.endsWith('.stl')).length,4);
 assert.ok(names.includes('calibration_manifest.json'));
 assert.ok(names.includes('README.txt'));
 const manifest=JSON.parse(strFromU8(files['calibration_manifest.json']));
 assert.equal(manifest.nozzle_diameter_mm,.4);
 assert.deepEqual(manifest.pieces.map(p=>p.clearance_per_side_mm),[.1,.15,.2,.25]);
 for(const name of names.filter(name=>name.endsWith('.stl')))assert.ok(files[name].length>1000,name+' is unexpectedly small');
 console.log('PASS calibration-coupon',names,manifest.pieces);
}finally{await browser.close();}

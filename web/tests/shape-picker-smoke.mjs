import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:5173');await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:120000});
 await page.locator('#change-area').click();
 await page.locator('#extent-shape').selectOption('square');await page.locator('#extent-width').fill('1000');assert.equal(await page.locator('#extent-height').isDisabled(),true);
 await page.locator('#extent-shape').selectOption('rectangle');await page.locator('#extent-height').fill('800');await page.locator('#extent-angle').fill('35');await page.locator('#extent-radius').fill('100');
 assert.equal(await page.locator('#area-reuse').isEnabled(),true);
 await page.screenshot({path:'../temp/picker-shapes.jpg',quality:70});
 await page.locator('#area-reuse').click();await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});
 assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());
 assert.ok((await page.evaluate(()=>window.contourDiagnostics.boundary.length))>4);
 await page.locator('#change-area').click();assert.equal(await page.locator('#extent-shape').inputValue(),'rectangle');assert.equal(await page.locator('#extent-angle').inputValue(),'35');assert.equal(await page.locator('#extent-radius').inputValue(),'100');
 await page.locator('#extent-shape').selectOption('circle');assert.equal(await page.locator('#extent-radius').isDisabled(),true);
 await page.locator('#area-reuse').click();await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});
 assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());assert.equal(await page.evaluate(()=>window.contourDiagnostics.boundary.length),96);
 await page.locator('#generate').click();await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.contourDiagnostics.asset?.watertight),true,await page.locator('#status').innerText());
 assert.deepEqual(errors,[]);console.log('PASS shape controls, rounded rotated terrain, retained settings, circle printable asset');
}finally{await browser.close();}

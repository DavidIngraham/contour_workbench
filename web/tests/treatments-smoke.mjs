import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.workerCalls=[];const send=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){window.workerCalls.push(message.type);return send.call(this,message,...rest);};});
try{
 await page.goto(new URL('?preset=post-canyon',process.env.APP_URL||'http://localhost:5173').toString());await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:240000});
 const before=await page.evaluate(()=>({calls:window.workerCalls.length,builds:window.contourDiagnostics.terrainBuilds}));
 await page.evaluate(()=>{const input=document.getElementById('base-height');for(let i=0;i<30;i++){input.value=String(1+i/10);input.dispatchEvent(new Event('input',{bubbles:true}));}});
 const after=await page.evaluate(()=>({calls:window.workerCalls.length,builds:window.contourDiagnostics.terrainBuilds,base:window.contourDiagnostics.baseHeight}));assert.equal(after.calls,before.calls);assert.equal(after.builds,before.builds);assert.equal(after.base,3.9);console.log('PASS: 30 base edits, zero worker jobs');
 await page.getByRole('button',{name:/Features/}).click();
 if(process.env.ALL_CARVE){for(const cls of ['trail','road','stream'])await page.locator('[data-class-treatment="'+cls+'"]').selectOption('v_carve');}else{await page.locator('[data-class="trail"]').uncheck();await page.locator('[data-class="road"]').uncheck();await page.locator('[data-class-treatment="stream"]').selectOption('v_carve');}
 await page.waitForFunction(()=>!window.contourDiagnostics.overlayBusy,null,{timeout:120000});
 assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());
 const counts=await page.evaluate(()=>window.contourDiagnostics.treatments);assert.ok(counts.v_carve>0);assert.equal(counts.insert||0,0);
 await page.screenshot({path:'../temp/contour-v-carve-preview.png'});
 await page.locator('#generate').click();await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});
 const state=await page.evaluate(()=>window.contourDiagnostics);assert.equal(state.asset?.watertight,true,await page.locator('#status').innerText());assert.equal(state.asset.pieces,0);assert.equal(state.terrainBuilds,before.builds);console.log('PASS V-carve class generates terrain without inserts',state.asset);
 await page.getByRole('button',{name:/Features/}).click();const stream=page.locator('[data-class-treatment="stream"]').locator('..').locator('..').locator('[data-treatment]').first();await stream.selectOption('insert');assert.equal(await page.locator('[data-class-treatment="stream"]').inputValue(),'mixed');
 await page.waitForFunction(()=>!window.contourDiagnostics.overlayBusy,null,{timeout:120000});assert.deepEqual(errors,[]);
 console.log('PASS individual override marks class mixed');
}finally{await browser.close();}

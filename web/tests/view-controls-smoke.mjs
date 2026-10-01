import assert from 'node:assert/strict';import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});const progress=[];await page.addInitScript(()=>{window.progressMessages=[];const Native=window.Worker;window.Worker=class extends Native{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data.progress)window.progressMessages.push(e.data.progress);});}};});
 await page.goto(new URL('?preset=post-canyon',process.env.APP_URL||'http://localhost:5173').toString());await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:120000});
 await page.waitForFunction(()=>document.getElementById('topo-attribution').textContent==='USGS The National Map',null,{timeout:60000});
 await page.screenshot({path:'../temp/contour-topo.png'});
 await page.locator('#topo-map').click();assert.equal(await page.locator('#topo-map').evaluate(e=>e.classList.contains('active')),false);await page.locator('#topo-map').click();
 await page.locator('#north-up').click();await page.waitForTimeout(700);const rotation=await page.locator('#north-arrow').evaluate(e=>Number(e.style.transform.match(/rotate\(([-\d.e]+)rad/)[1]));assert.ok(Math.abs(rotation)<.05,`North angle ${rotation}`);
 await page.locator('#quality').selectOption('0.05');await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});assert.ok((await page.evaluate(()=>window.progressMessages)).some(x=>x.includes('adaptive terrain')&&x.includes('0.05')));
 await page.getByRole('button',{name:/Features/}).click();const mode=page.locator('[data-treatment]').first();const toggle=page.locator('[data-toggle]').first();await mode.selectOption('v_carve');await toggle.uncheck();assert.equal(await mode.inputValue(),'v_carve');await toggle.check();assert.equal(await mode.inputValue(),'v_carve');assert.equal(await mode.locator('option').count(),2);
 console.log('PASS topo default/toggle, geographic north, adaptive progress, visibility retains V-carve');
}finally{await browser.close();}

import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(new URL('?preset=post-canyon',process.env.APP_URL||'http://localhost:5173').toString());await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,null,{timeout:90000});
 await page.locator('#change-area').click();await page.locator('#polygon-draw').click();
 const b=await page.locator('#extent-map').boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;
 for(const [dx,dy] of [[-60,-60],[60,-60],[10,0],[60,60],[-60,60]])await page.mouse.click(x+dx,y+dy);
 await page.locator('#polygon-finish').click();assert.equal(await page.locator('#area-reuse').isEnabled(),true);
 await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].some(i=>i.naturalWidth>0),null,{timeout:20000});
 await page.screenshot({path:'../temp/contour-polygon-map.png'});
 await page.locator('#area-reuse').click();await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});
 assert.equal(await page.locator('#status.error').count(),0,await page.locator('#status').innerText());
 let state=await page.evaluate(()=>window.contourDiagnostics);assert.equal(state.boundary.length,5);assert.equal(state.terrainBuilds,2);
 await page.locator('#generate').click();await page.waitForFunction(()=>!window.contourDiagnostics.busy,null,{timeout:120000});
 state=await page.evaluate(()=>window.contourDiagnostics);assert.equal(state.asset?.watertight,true,await page.locator('#status').innerText());
 await page.screenshot({path:'../temp/contour-polygon-model.png'});assert.deepEqual(errors,[]);console.log('PASS polygon map → clipped terrain → printable asset',state);
}finally{await browser.close();}

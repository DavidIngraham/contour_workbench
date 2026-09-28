import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({headless:true, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
await page.goto('http://localhost:5173');
try {await page.waitForFunction(()=>window.contourDiagnostics?.triangles&&!window.contourDiagnostics.busy,{},{timeout:90000});}catch(e){console.log('LOAD TIMEOUT',await page.locator('#status').innerText());}
console.log('STATE',await page.evaluate(()=>window.contourDiagnostics));
console.log('STATUS',await page.locator('#status').innerText());
await page.screenshot({path:'../temp/contour-design.png'});
await page.getByRole('button',{name:/Features/}).click();
const before=await page.evaluate(()=>window.contourDiagnostics);
const checkbox=page.locator('[data-toggle]').first();
if(await checkbox.count()){await checkbox.uncheck();console.log('TOGGLE',before,await page.evaluate(()=>window.contourDiagnostics));}
assert.equal((await page.evaluate(()=>window.contourDiagnostics)).terrainBuilds,before.terrainBuilds);
await page.locator('#generate').click();
try{await page.waitForFunction(()=>!window.contourDiagnostics.busy,{},{timeout:120000});}catch{}
console.log('GENERATED',await page.evaluate(()=>window.contourDiagnostics));console.log('GEN STATUS',await page.locator('#status').innerText());
await page.screenshot({path:'../temp/contour-review.png'});
assert.equal((await page.evaluate(()=>window.contourDiagnostics)).asset?.watertight,true);
const downloadPromise=page.waitForEvent('download',{timeout:120000});await page.locator('#download').click();const download=await downloadPromise;await download.saveAs('../temp/contour-print-bundle.zip');
await browser.close();

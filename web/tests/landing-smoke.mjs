import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const base=process.env.APP_URL||'http://localhost:5173';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(base);await page.waitForFunction(()=>window.contourDiagnostics?.landingOpen);
 assert.equal(await page.locator('[data-preset]').count(),2);assert.equal(await page.locator('#preset-new').count(),1);
 assert.equal(await page.locator('.preset-card img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true);
 await page.locator('[data-preset="post-canyon"]').click();
 await page.waitForFunction(()=>window.contourDiagnostics?.features===518&&!window.contourDiagnostics.busy&&!window.contourDiagnostics.landingOpen,null,{timeout:180000});
 assert.equal(await page.evaluate(()=>window.contourDiagnostics.terrainBuilds),0);assert.equal(await page.locator('[data-feature]').count(),518);
 console.log('PASS Post Canyon static preset',await page.evaluate(()=>({triangles:window.contourDiagnostics.triangles,features:window.contourDiagnostics.features})));
 await page.goto(base);await page.waitForFunction(()=>window.contourDiagnostics?.landingOpen);await page.locator('[data-preset="mt-hood-meadows"]').click();
 await page.waitForFunction(()=>window.contourDiagnostics?.features===458&&!window.contourDiagnostics.busy&&!window.contourDiagnostics.landingOpen,null,{timeout:180000});
 assert.equal(await page.evaluate(()=>window.contourDiagnostics.terrainBuilds),0);assert.equal(await page.locator('#winter-mode').isChecked(),true);
 console.log('PASS Meadows static preset',await page.evaluate(()=>({triangles:window.contourDiagnostics.triangles,features:window.contourDiagnostics.features})));
 await page.goto(base);await page.waitForFunction(()=>window.contourDiagnostics?.landingOpen);await page.locator('#preset-new').click();
 await page.waitForFunction(()=>window.contourDiagnostics?.wizardStep===1);assert.equal(await page.locator('#wizard-progress:not(.hidden)').count(),1);
 await page.waitForFunction(()=>!document.querySelector('#wizard-next')?.disabled);await page.locator('#wizard-next').click();assert.equal(await page.evaluate(()=>window.contourDiagnostics.wizardStep),2);
 await page.locator('#wizard-next').click();assert.equal(await page.evaluate(()=>window.contourDiagnostics.wizardStep),3);assert.equal(await page.locator('input[name="wizard-features"]').count(),3);
 await page.locator('#wizard-back').click();assert.equal(await page.evaluate(()=>window.contourDiagnostics.wizardStep),2);
 console.log('PASS new landscape wizard');
}finally{await browser.close();}

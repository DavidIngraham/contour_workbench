import {test,expect} from '@playwright/test';

const completionTimeoutMs=12*60*1000;
for(const preset of [
 {id:'post-canyon',name:'Post Canyon'},
 {id:'mt-hood-meadows',name:'Mt. Hood Meadows'}
]){
 test(`${preset.name} builds a watertight asset`,async({page})=>{
  await page.goto('/?preset='+preset.id);
  await page.waitForFunction(()=>Boolean((window as any).contourDiagnostics?.triangles)&&!(window as any).contourDiagnostics.busy,null,{timeout:120000});
  const started=Date.now();
  await page.locator('#generate').click();
  await page.waitForFunction(()=>!(window as any).contourDiagnostics.busy&&((window as any).contourDiagnostics.asset||document.querySelector('#status.error')),null,{timeout:completionTimeoutMs});
  const elapsedMs=Date.now()-started,status=await page.locator('#status').innerText(),asset=await page.evaluate(()=>(window as any).contourDiagnostics.asset);
  expect(await page.locator('#status.error').count(),status).toBe(0);
  expect(asset?.watertight,status).toBe(true);
  expect(asset?.removed_terrain_islands,status).toBeGreaterThanOrEqual(0);
  if(preset.id==='post-canyon')expect(asset.removed_terrain_islands,status).toBeGreaterThan(0);
  console.log(`${preset.name}: ${(elapsedMs/1000).toFixed(1)} s, ${asset.pieces} insert pieces, ${asset.triangles} terrain triangles, ${asset.removed_terrain_islands} terrain pins removed`);
 });
}

import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.goto(process.env.APP_URL||'http://localhost:5173');
const result=await page.evaluate(async()=>{const {loadElevation}=await import('/src/providers.ts');const messages=[];try{const data=await loadElevation([-121.635,45.675,-121.625,45.685],'usgs_3dep_10m',async()=>[],s=>messages.push(s),new AbortController().signal);return {width:data.grid.width,height:data.grid.height,finite:data.grid.elevations.every(Number.isFinite),source:data.source,messages};}catch(e){return {error:String(e),messages};}});
console.log(JSON.stringify(result,null,2));assert.equal(result.error,undefined);assert.equal(result.finite,true);
}finally{await browser.close();}

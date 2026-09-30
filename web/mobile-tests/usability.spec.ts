import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.route('**/examples/post-canyon.json',route=>route.fulfill({json:{name:'Mobile landscape',grid:{bounds:[-.001,-.001,.011,.011],width:5,height:5,elevations:Array(25).fill(100)},geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{highway:'path',name:'Test trail'},geometry:{type:'LineString',coordinates:[[.003,.005],[.007,.005]]}},{type:'Feature',properties:{natural:'water',water:'lake',name:'Test lake'},geometry:{type:'Polygon',coordinates:[[[.002,.002],[.008,.002],[.008,.004],[.002,.004],[.002,.002]]]}}]},source:{name:'Test elevation',attribution:'Test'},boundary:[[0,0],[.01,0],[.01,.01],[0,.01]]}}));
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).contourDiagnostics?.triangles&&!(window as any).contourDiagnostics.busy);
});
test('full-width model, touch controls, settings and feature editing',async({page})=>{
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const viewport=await page.locator('#viewport').boundingBox();expect(viewport!.width).toBe(page.viewportSize()!.width);
 for(const id of ['mobile-settings','fit-view','wireframe','generate','open-project','save-project']){const b=await page.locator('#'+id).boundingBox();expect(b!.width).toBeGreaterThanOrEqual(44);expect(b!.height).toBeGreaterThanOrEqual(44);}
 await page.locator('#wireframe').tap();await expect(page.locator('#wireframe')).toHaveClass(/active/);
 await page.locator('#mobile-settings').tap();await expect(page.locator('#mobile-settings')).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:/^Features/,exact:false}).tap();await page.locator('[data-class-treatment="trail"]').selectOption('v_carve');await page.waitForFunction(()=>!(window as any).contourDiagnostics.overlayBusy);await page.locator('[data-toggle]').first().uncheck();await page.locator('[data-toggle]').first().check();await expect(page.locator('[data-treatment]').first()).toHaveValue('v_carve');
 const lake=page.locator('[data-feature]').filter({hasText:'Test lake'});await lake.tap();await expect(lake.locator('[data-surface]')).toBeVisible();await lake.locator('[data-surface]').selectOption('level');await expect(lake.locator('[data-zone-depth]')).toBeVisible();
 await page.getByRole('button',{name:'Print setup',exact:true}).tap();await expect(page.locator('#nozzle-diameter')).toHaveValue('0.4');await expect(page.locator('#download-calibration')).toBeVisible();
 await page.locator('#mobile-close').tap();await expect(page.locator('#mobile-settings')).toHaveAttribute('aria-expanded','false');
 await page.locator('#generate').tap();await page.waitForFunction(()=>!(window as any).contourDiagnostics.busy);expect(await page.evaluate(()=>(window as any).contourDiagnostics.asset?.watertight)).toBe(true);await expect(page.locator('#download')).toBeEnabled();
});
test('polygon picker and annotation controls stay reachable',async({page})=>{
 await page.locator('#mobile-settings').tap();await page.locator('#change-area').tap();await expect(page.locator('#area-dialog')).toBeVisible();
 await page.locator('#extent-shape').selectOption('circle');await page.locator('#extent-width').fill('600');await expect(page.locator('#extent-angle')).toBeDisabled();await expect(page.locator('#area-reuse')).toBeEnabled();await page.locator('#area-reuse').tap();await page.waitForFunction(()=>!(window as any).contourDiagnostics.busy);await expect(page.locator('#area-dialog')).toBeHidden();
 await page.locator('#mobile-settings').tap();await page.getByRole('button',{name:'Annotations',exact:true}).tap();await page.locator('#add-text').tap();await page.locator('#ann-text').fill('Mobile');await page.locator('[data-ann-number="width_mm"]').fill('20');await expect(page.locator('#annotation-warning')).toHaveText('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#mobile-close').tap();await expect(page.locator('#generate')).toBeVisible();
});

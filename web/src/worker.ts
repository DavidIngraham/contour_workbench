/// <reference lib="webworker" />
import {annotationGeometry,type Annotation} from './annotations';
import {calibrationSwitchbackCenterlineMm} from './calibration-path';
import {calibrationClearances,fitProfile,insetAtHeight} from './insert-fit';
import {insetCrossSection,shouldTaperInsert} from './insert-taper';
import init,* as core from './wasm/contour_wasm';
import ManifoldModule from 'manifold-3d';
import manifoldUrl from 'manifold-3d/manifold.wasm?url';
import {zipSync,strToU8} from 'fflate';
import {buildThreeMf,type ThreeMfKind} from './three-mf';
import type {Grid,Settings,Feature,Terrain,Overlay,Mesh,Asset,Piece,Project} from './types';

const ready=init();
let manifold:Awaited<ReturnType<typeof ManifoldModule>>|undefined;
let grid:Grid,settings:Settings,terrain:Terrain,features:Feature[]=[];
let terrainBuilds=0;
function packed(m:Mesh):Mesh{return {positions:new Float32Array(m.positions),indices:new Uint32Array(m.indices)}}
function meshBytes(m:Mesh){const positions=Float32Array.from(m.positions),indices=Uint32Array.from(m.indices),out=new Uint8Array(8+positions.byteLength+indices.byteLength),view=new DataView(out.buffer);view.setUint32(0,positions.length,true);view.setUint32(4,indices.length,true);out.set(new Uint8Array(positions.buffer),8);out.set(new Uint8Array(indices.buffer),8+positions.byteLength);return out;}
function stl(m:Mesh){let out='solid contour_workbench\n';for(let i=0;i<m.indices.length;i+=3){out+='facet normal 0 0 0\nouter loop\n';for(let k=0;k<3;k++){const j=m.indices[i+k]*3;out+=`vertex ${m.positions[j]} ${m.positions[j+1]} ${m.positions[j+2]}\n`;}out+='endloop\nendfacet\n';}return strToU8(out+'endsolid contour_workbench\n');}
function exportMesh(m:Mesh,tolerance=.0001):Mesh{
 const positions:number[]=[],remap:number[]=[],bins=new Map<string,number[]>();
 for(let i=0;i<m.positions.length;i+=3){const p=m.positions.slice(i,i+3),cell=p.map(v=>Math.floor(v/tolerance));let match:number|undefined;
  search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const ids=bins.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[];for(const id of ids)if(p.every((v,k)=>Math.abs(v-positions[id*3+k])<=tolerance)){match=id;break search;}}
  if(match===undefined){match=positions.length/3;positions.push(...p);const key=cell.join(',');bins.set(key,[...(bins.get(key)||[]),match]);}remap.push(match);
 }
 const faces:(number[]|null)[]=[],pending=new Map<string,number>();
 for(let i=0;i<m.indices.length;i+=3){const f=[remap[m.indices[i]],remap[m.indices[i+1]],remap[m.indices[i+2]]];if(new Set(f).size<3)continue;const key=[...f].sort((a,b)=>a-b).join(','),prev=pending.get(key);if(prev!==undefined){const g=faces[prev]!,k=g.indexOf(f[0]);if(f[1]===g[(k+2)%3]){faces[prev]=null;pending.delete(key);continue;}}pending.set(key,faces.length);faces.push(f);}
 return {positions,indices:faces.filter((f):f is number[]=>f!==null).flat()};
}
function validate(m:Mesh){const canonical=new Map<string,number>(),remap:number[]=[];for(let i=0;i<m.positions.length;i+=3){const p=[m.positions[i],m.positions[i+1],m.positions[i+2]];if(p.some(v=>!Number.isFinite(v)))throw new Error('Non-finite mesh coordinate');const key=p.map(v=>v.toFixed(8)).join(',');if(!canonical.has(key))canonical.set(key,canonical.size);remap.push(canonical.get(key)!);}const edges=new Map<string,{count:number;sum:number}>();for(let i=0;i<m.indices.length;i+=3){const t=[remap[m.indices[i]],remap[m.indices[i+1]],remap[m.indices[i+2]]];if(new Set(t).size!==3)throw new Error('Export contains degenerate triangles');for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`,edge=edges.get(key)||{count:0,sum:0};edge.count++;edge.sum+=a<b?1:-1;edges.set(key,edge);}}if([...edges.values()].some(e=>e.count!==2||e.sum!==0))throw new Error('Generated mesh is not watertight');}
async function geometry(progress:(s:string)=>void){if(!manifold){progress('Loading the solid geometry engine…');manifold=await ManifoldModule({locateFile:()=>manifoldUrl});manifold.setup();}return manifold;}
function solid(M:any,m:Mesh){const mesh=new M.Mesh({numProp:3,vertProperties:new Float32Array(m.positions),triVerts:new Uint32Array(m.indices)});mesh.merge();const result=new M.Manifold(mesh);if(result.status()!=='NoError'){const error=result.status();result.delete();throw new Error(`Solid geometry is invalid: ${error}`);}return result;}
function combineMeshes(meshes:Mesh[]):Mesh{
 const positionCount=meshes.reduce((sum,mesh)=>sum+mesh.positions.length,0),indexCount=meshes.reduce((sum,mesh)=>sum+mesh.indices.length,0);
 const positions=new Float32Array(positionCount),indices=new Uint32Array(indexCount);let positionOffset=0,indexOffset=0,vertexOffset=0;
 for(const mesh of meshes){positions.set(mesh.positions,positionOffset);for(const index of mesh.indices)indices[indexOffset++]=Number(index)+vertexOffset;positionOffset+=mesh.positions.length;vertexOffset+=mesh.positions.length/3;}
 return {positions,indices};
}
function validatedMesh(input:any,label:string):Mesh{let last:unknown;for(const tolerance of [0,0.0001,0.001,0.005]){const clean=tolerance?input.simplify(tolerance):input;try{const raw=clean.getMesh(),source={positions:Array.from(raw.vertProperties) as number[],indices:Array.from(raw.triVerts) as number[]};for(const weldTolerance of [0.0000001,0.000001,0.00001,0.0001]){try{const mesh=exportMesh(source,weldTolerance);validate(mesh);return mesh;}catch(e){last=e;}}throw last;}catch(e){last=e;}finally{if(clean!==input)clean.delete();}}throw new Error(label+': '+String(last));}
function taperedSolid(M:any,prism:any,className:string,s:Settings,depthMm:number,reliefOverride?:number){
 const bounds=prism.boundingBox(),totalDepth=bounds.max[2]-bounds.min[2],profile=fitProfile(s,className,Math.min(depthMm,totalDepth),reliefOverride);
 if(profile.maximumInsetMm<=1e-7)return {solid:prism,profile};
 const epsilon=Math.min(.001,totalDepth/100),section=prism.slice(bounds.min[2]+epsilon),layerMm=Math.max(.1,Math.min(.25,s.nozzle_diameter_mm/2));
 const profiledDepth=Math.min(totalDepth,profile.depthMm),divisions=Math.max(1,Math.ceil(profiledDepth/layerMm)),bands:any[]=[];
 try{
  for(let i=0;i<divisions;i++){
   const z0=profiledDepth*i/divisions,z1=profiledDepth*(i+1)/divisions,{cross,owned}=insetCrossSection(section,insetAtHeight(profile,z0));
   bands.push(cross.extrude(z1-z0+.0002).translate([0,0,bounds.min[2]+z0-.0001]));if(owned)cross.delete();
  }
  if(totalDepth>profiledDepth-.0001)bands.push(section.extrude(totalDepth-profiledDepth+.0002).translate([0,0,bounds.min[2]+profiledDepth-.0001]));
  if(!bands.length)return {solid:prism,profile};
  const envelope=M.Manifold.union(bands),tapered=envelope.intersect(prism);envelope.delete();
  if(tapered.status()!=='NoError'||tapered.isEmpty()){tapered.delete();return {solid:prism,profile};}
  return {solid:tapered,profile};
 }finally{section.delete();bands.forEach(b=>b.delete());}
}
function safeTaperedSolid(M:any,prism:any,className:string,s:Settings,depthMm:number){
 for(const factor of [1,.75,.5,.25]){
  const adjusted={...s,insert_draft_angle_deg:s.insert_draft_angle_deg*factor};let candidate;
  try{candidate=taperedSolid(M,prism,className,adjusted,depthMm,s.insert_elephant_foot_relief_mm*factor);}catch{continue;}
  if(candidate.solid===prism)continue;
  try{validatedMesh(candidate.solid,'Taper check');return candidate;}catch{candidate.solid.delete();}
 }
 const adjusted={...s,insert_elephant_foot_relief_mm:0,insert_elephant_foot_height_mm:0,insert_draft_angle_deg:0};
 return {solid:prism,profile:fitProfile(adjusted,className,depthMm,0)};
}

const digitSegments:Record<string,string>={1:'bc',2:'abdeg',3:'abcdg',4:'bcfg'};
function digitCutters(M:any,digit:string,cx:number,cy:number,z:number){const map:{[key:string]:[number,number,number,number]}={a:[0,2,2.4,.42],g:[0,0,2.4,.42],d:[0,-2,2.4,.42],f:[-1.2,1,.42,1.8],b:[1.2,1,.42,1.8],e:[-1.2,-1,.42,1.8],c:[1.2,-1,.42,1.8]};return [...(digitSegments[digit]||'')].map(key=>{const [x,y,w,h]=map[key];return M.Manifold.cube([w,h,.6]).translate([cx+x-w/2,cy+y-h/2,z]);});}
function switchbackSolid(M:any,cx:number,cy:number,widthMm:number,heightMm:number,zMm:number){
 const points=calibrationSwitchbackCenterlineMm.map(([x,y])=>[x+cx,y+cy] as [number,number]),parts:any[]=[];
 try{
  for(let i=1;i<points.length;i++){const [x0,y0]=points[i-1],[x1,y1]=points[i],dx=x1-x0,dy=y1-y0,length=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)*180/Math.PI;parts.push(M.Manifold.cube([length,widthMm,heightMm]).translate([-length/2,-widthMm/2,0]).rotate([0,0,angle]).translate([(x0+x1)/2,(y0+y1)/2,zMm]));}
  for(const [x,y] of points)parts.push(M.Manifold.cylinder(heightMm,widthMm/2,widthMm/2,16).translate([x,y,zMm]));
  return M.Manifold.union(parts);
 }finally{parts.forEach(part=>part.delete());}
}
function calibrationFiles(M:any,s:Settings,prefix='calibration/'):Record<string,Uint8Array>{
 const clearances=calibrationClearances(s),centers=[14,38,62,86],pathWidth=Math.max(.05,s.path_width_mm);let base=M.Manifold.cube([100,38,3]);const cutters:any[]=[];
 try{
  clearances.forEach((clearance,index)=>{cutters.push(switchbackSolid(M,centers[index],12,pathWidth+2*clearance,2.2,1));cutters.push(...digitCutters(M,String(index+1),centers[index],32,2.7));});
  const combined=M.Manifold.union(cutters),cut=base.subtract(combined);base.delete();base=cut;combined.delete();
  const files:Record<string,Uint8Array>={[prefix+'coupon-base.stl']:stl(validatedMesh(base,'Calibration coupon base'))},pieces:any[]=[];
  clearances.forEach((clearance,index)=>{const prism=switchbackSolid(M,8,6.2,pathWidth,2,0),tapered=safeTaperedSolid(M,prism,'trail',s,2);files[`${prefix}insert-${index+1}-clearance-${clearance.toFixed(2)}mm.stl`]=stl(validatedMesh(tapered.solid,`Calibration switchback insert ${index+1}`));if(tapered.solid!==prism)tapered.solid.delete();prism.delete();pieces.push({label:index+1,clearance_per_side_mm:clearance,file:`insert-${index+1}-clearance-${clearance.toFixed(2)}mm.stl`,geometry:'trail_switchback',path_width_mm:pathWidth});});
  files[prefix+'calibration_manifest.json']=strToU8(JSON.stringify({units:'mm',geometry:'trail_switchback',path_width_mm:pathWidth,nozzle_diameter_mm:s.nozzle_diameter_mm,elephant_foot_relief_mm:s.insert_elephant_foot_relief_mm,elephant_foot_height_mm:s.insert_elephant_foot_height_mm,draft_angle_deg:s.insert_draft_angle_deg,pieces},null,2));
  files[prefix+'README.txt']=strToU8('CONTOUR WORKBENCH SWITCHBACK FIT TEST\n\nThis coupon uses narrow trail geometry with close parallel runs, tight hairpins, and an angled jog. It exposes first-layer swelling, fused switchback gaps, corner loss, and clearance problems that a rectangular coupon can miss.\n\nPrint coupon-base.stl normally. Print each numbered switchback insert with its flat, narrow end on the build plate. Match insert numbers to the engraved numbers beside the pockets. Choose the smallest number that seats through every turn without force, then enter its clearance-per-side value in Print setup.\n\nConfigured path width: '+pathWidth.toFixed(2)+' mm\nConfigured nozzle: '+s.nozzle_diameter_mm.toFixed(2)+' mm\n\n'+pieces.map(p=>`${p.label}: ${p.clearance_per_side_mm.toFixed(2)} mm clearance per side\n`).join(''));
  return files;
 }finally{base.delete();cutters.forEach(c=>c.delete());}
}
function syncBase(next:Settings){if(!terrain)return;const delta=next.base_height_mm-terrain.layout.base_height;if(delta){for(let i=2;i<terrain.mesh.positions.length;i+=3)if(terrain.mesh.positions[i]>0)terrain.mesh.positions[i]+=delta;terrain.layout.base_height=next.base_height_mm;}}
async function handle(type:string,p:any,progress:(s:string)=>void):Promise<any>{
 await ready;
 switch(type){
  case 'hydrate':grid=p.project.grid;settings=p.project.settings;features=p.project.features;terrain=p.terrain;return true;
  case 'classify':return JSON.parse(core.classify_features(JSON.stringify(p)));
  case 'urls':return JSON.parse(core.source_urls(JSON.stringify(p.bounds),p.ninety));
  case 'query':return core.osm_query(JSON.stringify(p.bounds??p),Boolean(p.winter));
  case 'terrain':grid=p.grid;settings=p.settings;features=p.features;progress(settings.terrain_max_error_mm>0?`Building adaptive terrain (≤ ${settings.terrain_max_error_mm} mm sampled error)…`:'Building terrain at full source resolution…');terrain=JSON.parse(core.build_terrain(JSON.stringify(grid),JSON.stringify(settings)));terrainBuilds++;return {...terrain,mesh:packed(terrain.mesh),terrainBuilds};
  case 'overlays':syncBase(p.settings);features=p.features;settings=p.settings;progress('Draping features over the terrain…');return JSON.parse(core.build_overlays(JSON.stringify(grid),JSON.stringify(settings),JSON.stringify(features),JSON.stringify(terrain.layout))).map((o:Overlay)=>({...o,mesh:packed(o.mesh)}));
  case 'generate':{
   if(!terrain)throw new Error('Load terrain first');syncBase(p.settings);features=p.features;settings=p.settings;progress('Building tapered inserts and continuous pockets…');
   const plan:{inserts:Piece[];cutters:Mesh[];cutter_group_ends?:number[];removed_terrain_islands:number}=JSON.parse(core.build_plan(JSON.stringify(grid),JSON.stringify(settings),JSON.stringify(features),JSON.stringify(terrain.layout))),M=await geometry(progress);
   let result=solid(M,terrain.mesh);const raisedTerrain=plan.inserts.some(piece=>piece.conformal)?result.translate([0,0,0.35]):undefined;
   try{
    if(plan.cutters.length){
     const groupEnds=plan.cutter_group_ends?.length?plan.cutter_group_ends:[plan.cutters.length];let groupStart=0;
     try{
      for(let groupIndex=0;groupIndex<groupEnds.length;groupIndex++){const groupEnd=groupEnds[groupIndex],group=plan.cutters.slice(groupStart,groupEnd);progress(`Cutting terrain pocket group ${groupIndex+1} of ${groupEnds.length}…`);const combined=solid(M,combineMeshes(group));try{const next=result.subtract(combined);result.delete();result=next;}finally{combined.delete();}if(result.status()!=='NoError'||result.numTri()===0)throw new Error(`Pocket group ${groupIndex+1} did not produce a valid terrain solid`);groupStart=groupEnd;}
     }catch(error){throw new Error('Terrain pockets: '+(error instanceof Error?error.message:String(error)));}
    }
    if(result.status()!=='NoError'||result.numTri()===0)throw new Error('Terrain subtraction did not produce a valid solid');
    if(p.annotations?.length){progress('Adding annotations and attached porches…');for(const a of p.annotations as Annotation[]){if(!a.enabled)continue;const data=annotationGeometry(a,grid,settings,terrain.layout);if(data.porch){const porch=solid(M,data.porch),next=result.add(porch);porch.delete();result.delete();result=next;}const parts=data.solids.map(m=>solid(M,m));try{const label=M.Manifold.union(parts),next=a.treatment==='raised'?result.add(label):result.subtract(label);label.delete();result.delete();result=next;}finally{parts.forEach(m=>m.delete());}if(result.status()!=='NoError')throw new Error('Annotation '+a.name+' could not form a solid. Move it or adjust its size.');}}
    const mesh=validatedMesh(result,'Terrain');
    for(let pieceIndex=0;pieceIndex<plan.inserts.length;pieceIndex++){
     const piece=plan.inserts[pieceIndex];if(pieceIndex%10===0)progress('Preparing insert '+(pieceIndex+1)+' of '+plan.inserts.length+'…');
     try{
      const prism=solid(M,piece.mesh),tapered=shouldTaperInsert(piece.mesh.indices.length)?safeTaperedSolid(M,prism,piece.class,settings,piece.insert_depth_mm):{solid:prism,profile:fitProfile({...settings,insert_elephant_foot_relief_mm:0,insert_elephant_foot_height_mm:0,insert_draft_angle_deg:0},piece.class,piece.insert_depth_mm,0)};let raw=tapered.solid;
      try{
       piece.taper_relief_mm=tapered.profile.footReliefMm;piece.taper_height_mm=tapered.profile.footHeightMm;piece.draft_angle_deg=tapered.profile.draftAngleDeg;
       if(piece.conformal){if(!raisedTerrain)throw new Error('Terrain surface is unavailable for '+piece.id);const global=tapered.solid.translate(piece.origin),fitted=global.intersect(raisedTerrain);global.delete();raw=fitted.translate(piece.origin.map(v=>-v) as [number,number,number]);fitted.delete();}
       piece.mesh=validatedMesh(raw,piece.id);
      }finally{if(raw!==tapered.solid)raw.delete();if(tapered.solid!==prism)tapered.solid.delete();prism.delete();}
     }catch(error){throw new Error(piece.id+' ('+(pieceIndex+1)+'/'+plan.inserts.length+'): '+(error instanceof Error?error.message:String(error)));}
    }
    plan.inserts=plan.inserts.filter(piece=>piece.mesh.indices.length>0);
    return {terrain:packed(mesh),inserts:plan.inserts.map(i=>({...i,mesh:packed(i.mesh)})),validation:{watertight:true,triangles:mesh.indices.length/3,pieces:plan.inserts.length,removed_terrain_islands:plan.removed_terrain_islands},revision:p.revision};
   }finally{result.delete();raisedTerrain?.delete();}
  }
  case 'preset-pack':{
   if(!terrain)throw new Error('Build terrain before packing a preset.');
   const project=p.project as Project,raw=JSON.parse(core.build_overlays(JSON.stringify(project.grid),JSON.stringify(project.settings),JSON.stringify(project.features),JSON.stringify(terrain.layout))) as Overlay[];
   const files:Record<string,Uint8Array>={},terrainFile='terrain.mesh';
   files[terrainFile]=meshBytes(terrain.mesh);
   const packedOverlays=raw.map((overlay,index)=>{const file=`overlays/${index}.mesh`;files[file]=meshBytes(overlay.mesh);return {...overlay,mesh:file};});
   files['manifest.json']=strToU8(JSON.stringify({version:1,project,terrain:{...terrain,mesh:terrainFile},overlays:packedOverlays}));
   return zipSync(files,{level:6});
  }
  case 'calibration':{const M=await geometry(progress);progress('Building nozzle-aware fit-test pieces…');return zipSync(calibrationFiles(M,p.settings as Settings,''),{level:3});}
  case 'export-3mf':{
   const kind=p.kind as ThreeMfKind;progress(kind==='bambu'?'Arranging terrain and inserts across Bambu Studio plates…':'Packaging an assembled portable 3MF…');return buildThreeMf(p.asset as Asset,p.project as Project,kind);
  }
  case 'export':{
   const asset=p.asset as Asset,project=p.project as Project;progress('Packaging validated STL files and fit test…');
   const files:Record<string,Uint8Array>={'terrain.stl':stl(asset.terrain),'project.contour.json':strToU8(JSON.stringify(project)),'validation.json':strToU8(JSON.stringify(asset.validation,null,2)),'attribution.txt':strToU8(project.source.attribution+'\nOpenStreetMap data: © OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright\n')};
   for(const piece of asset.inserts)files[`inserts/${piece.id}.stl`]=stl(piece.mesh);
   files['insert_manifest.json']=strToU8(JSON.stringify({units:'mm',settings:project.settings,source:project.source,pieces:asset.inserts.map(i=>({file:`${i.id}.stl`,class:i.class,assembly_origin_mm:i.origin,taper_relief_mm:i.taper_relief_mm,taper_height_mm:i.taper_height_mm,draft_angle_deg:i.draft_angle_deg}))},null,2));
   Object.assign(files,calibrationFiles(await geometry(progress),project.settings));return zipSync(files,{level:3});
  }
  default:throw new Error('Unknown operation');
 }
}
self.onmessage=async(e:MessageEvent)=>{const {id,type,payload}=e.data;try{const result=await handle(type,payload,message=>self.postMessage({id,progress:message})),transfers:Transferable[]=[];const visit=(v:any)=>{if(ArrayBuffer.isView(v))transfers.push(v.buffer as ArrayBuffer);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(result);self.postMessage({id,result},[...new Set(transfers)]);}catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}};

import {annotationGeometry,type Annotation} from './annotations';
/// <reference lib="webworker" />
import init,* as core from './wasm/contour_wasm';
import ManifoldModule from 'manifold-3d';
import manifoldUrl from 'manifold-3d/manifold.wasm?url';
import {zipSync,strToU8} from 'fflate';
import type {Grid,Settings,Feature,Terrain,Overlay,Mesh,Asset,Piece,Project} from './types';
const ready=init();let manifold:Awaited<ReturnType<typeof ManifoldModule>>|undefined;
let grid:Grid,settings:Settings,terrain:Terrain,features:Feature[]=[];let terrainBuilds=0;
function packed(m:Mesh):Mesh{return {positions:new Float32Array(m.positions),indices:new Uint32Array(m.indices)}}
function stl(m:Mesh){let out='solid contour_workbench\n';for(let i=0;i<m.indices.length;i+=3){out+='facet normal 0 0 0\nouter loop\n';for(let k=0;k<3;k++){const j=m.indices[i+k]*3;out+=`vertex ${m.positions[j]} ${m.positions[j+1]} ${m.positions[j+2]}\n`;}out+='endloop\nendfacet\n';}return strToU8(out+'endsolid contour_workbench\n');}
// STL identifies vertices by coordinates. Normalize the Float32 output before validating it.
function exportMesh(m:Mesh,tolerance=.0001):Mesh{
 const positions:number[]=[],remap:number[]=[],bins=new Map<string,number[]>();
 for(let i=0;i<m.positions.length;i+=3){const p=m.positions.slice(i,i+3),cell=p.map(v=>Math.floor(v/tolerance));let match:number|undefined;
  search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const ids=bins.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[];for(const id of ids){if(p.every((v,k)=>Math.abs(v-positions[id*3+k])<=tolerance)){match=id;break search;}}}
  if(match===undefined){match=positions.length/3;positions.push(...p);const key=cell.join(',');bins.set(key,[...(bins.get(key)||[]),match]);}remap.push(match);
 }
 const faces:(number[]|null)[]=[],pending=new Map<string,number>();
 for(let i=0;i<m.indices.length;i+=3){const f=[remap[m.indices[i]],remap[m.indices[i+1]],remap[m.indices[i+2]]];if(new Set(f).size<3)continue;const key=[...f].sort((a,b)=>a-b).join(',');const prev=pending.get(key);if(prev!==undefined){const g=faces[prev]!;const k=g.indexOf(f[0]);if(f[1]===g[(k+2)%3]){faces[prev]=null;pending.delete(key);continue;}}pending.set(key,faces.length);faces.push(f);}
 return {positions,indices:faces.filter((f):f is number[]=>f!==null).flat()};
}
function validate(m:Mesh){const canonical=new Map<string,number>();const remap:number[]=[];for(let i=0;i<m.positions.length;i+=3){const p=[m.positions[i],m.positions[i+1],m.positions[i+2]];if(p.some(v=>!Number.isFinite(v)))throw new Error('Non-finite mesh coordinate');const key=p.map(v=>v.toFixed(8)).join(',');if(!canonical.has(key))canonical.set(key,canonical.size);remap.push(canonical.get(key)!);}const edges=new Map<string,{count:number;sum:number}>();for(let i=0;i<m.indices.length;i+=3){const t=[remap[m.indices[i]],remap[m.indices[i+1]],remap[m.indices[i+2]]];if(new Set(t).size!==3)throw new Error('Export contains degenerate triangles');for(let k=0;k<3;k++){const a=t[k],b=t[(k+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;const edge=edges.get(key)||{count:0,sum:0};edge.count++;edge.sum+=a<b?1:-1;edges.set(key,edge);}}if([...edges.values()].some(e=>e.count!==2||e.sum!==0))throw new Error('Generated mesh is not watertight');}
function syncBase(next:Settings){if(!terrain)return;const delta=next.base_height_mm-terrain.layout.base_height;if(delta){for(let i=2;i<terrain.mesh.positions.length;i+=3)if(terrain.mesh.positions[i]>0)terrain.mesh.positions[i]+=delta;terrain.layout.base_height=next.base_height_mm;}}
async function handle(type:string,p:any,progress:(s:string)=>void):Promise<any>{await ready;switch(type){
 case 'classify':return JSON.parse(core.classify_features(JSON.stringify(p)));
 case 'urls':return JSON.parse(core.source_urls(JSON.stringify(p.bounds),p.ninety));
 case 'query':return core.osm_query(JSON.stringify(p.bounds??p),Boolean(p.winter));
 case 'terrain':grid=p.grid;settings=p.settings;features=p.features;progress(settings.terrain_max_error_mm>0?`Building adaptive terrain (≤ ${settings.terrain_max_error_mm} mm sampled error)…`:'Building terrain at full source resolution…');terrain=JSON.parse(core.build_terrain(JSON.stringify(grid),JSON.stringify(settings)));terrainBuilds++;return {...terrain,mesh:packed(terrain.mesh),terrainBuilds};
 case 'overlays':syncBase(p.settings);features=p.features;settings=p.settings;progress('Draping features over the terrain…');return JSON.parse(core.build_overlays(JSON.stringify(grid),JSON.stringify(settings),JSON.stringify(features),JSON.stringify(terrain.layout))).map((o:Overlay)=>({...o,mesh:packed(o.mesh)}));
 case 'generate':{
 if(!terrain)throw new Error('Load terrain first');syncBase(p.settings);features=p.features;settings=p.settings;progress('Building fitted inserts and continuous pockets…');const plan:{inserts:Piece[];cutters:Mesh[]}=JSON.parse(core.build_plan(JSON.stringify(grid),JSON.stringify(settings),JSON.stringify(features),JSON.stringify(terrain.layout)));
 if(!manifold){progress('Loading the solid geometry engine…');manifold=await ManifoldModule({locateFile:()=>manifoldUrl});manifold.setup();}const M=manifold;
 const solid=(m:Mesh)=>{const mesh=new M.Mesh({numProp:3,vertProperties:new Float32Array(m.positions),triVerts:new Uint32Array(m.indices)});mesh.merge();const result=new M.Manifold(mesh);if(result.status()!=='NoError'){const error=result.status();result.delete();throw new Error(`Solid geometry is invalid: ${error}`);}return result;};
 const validatedMesh=(input:InstanceType<typeof M.Manifold>,label:string):Mesh=>{let last:unknown;for(const tolerance of [0,0.0001,0.001,0.005]){const clean=tolerance?input.simplify(tolerance):input;try{const raw=clean.getMesh();const source={positions:Array.from(raw.vertProperties),indices:Array.from(raw.triVerts)};for(const weldTolerance of [0.0000001,0.000001,0.00001,0.0001]){try{const mesh=exportMesh(source,weldTolerance);validate(mesh);return mesh;}catch(e){last=e;}}throw last;}catch(e){last=e;}finally{if(clean!==input)clean.delete();}}throw new Error(label+': '+String(last));};
 let result=solid(terrain.mesh);
 const raisedTerrain=plan.inserts.some(piece=>piece.conformal)?result.translate([0,0,0.35]):undefined;
 const cutters:InstanceType<typeof M.Manifold>[]=[];
 try{
  for(const cut of plan.cutters)cutters.push(solid(cut));
  if(cutters.length){
   progress(`Cutting terrain for ${plan.inserts.length} pieces…`);
   const combined=M.Manifold.union(cutters);
   const next=result.subtract(combined);
   result.delete();
   combined.delete();
   result=next;
  }
  if(result.status()!=='NoError'||result.numTri()===0)throw new Error('Terrain subtraction did not produce a valid solid');
  if(p.annotations?.length){
   progress('Adding annotations and attached porches…');
   for(const a of p.annotations as Annotation[]){
    if(!a.enabled)continue;
    const geometry=annotationGeometry(a,grid,settings,terrain.layout);
    if(geometry.porch){
     const porch=solid(geometry.porch);
     const next=result.add(porch);
     porch.delete();
     result.delete();
     result=next;
    }
    const parts=geometry.solids.map(m=>solid(m));
    try{
     const label=M.Manifold.union(parts);
     const next=a.treatment==='raised'?result.add(label):result.subtract(label);
     label.delete();
     result.delete();
     result=next;
    }finally{parts.forEach(m=>m.delete());}
    if(result.status()!=='NoError')throw new Error('Annotation '+a.name+' could not form a solid. Move it or adjust its size.');
   }
  }
  const mesh=validatedMesh(result,'Terrain');
  for(const piece of plan.inserts){
   const prism=solid(piece.mesh);
   let raw=prism;
   try{
    if(piece.conformal){
     if(!raisedTerrain)throw new Error('Terrain surface is unavailable for '+piece.id);
     const global=prism.translate(piece.origin);
     const fitted=global.intersect(raisedTerrain);
     global.delete();
     raw=fitted.translate(piece.origin.map(v=>-v) as [number,number,number]);
     fitted.delete();
    }
    piece.mesh=validatedMesh(raw,piece.id);
   }finally{
    if(raw!==prism)raw.delete();
    prism.delete();
   }
  }
  plan.inserts=plan.inserts.filter(p=>p.mesh.indices.length>0);
  return {terrain:packed(mesh),inserts:plan.inserts.map(i=>({...i,mesh:packed(i.mesh)})),validation:{watertight:true,triangles:mesh.indices.length/3,pieces:plan.inserts.length},revision:p.revision};
 }finally{
  result.delete();
  raisedTerrain?.delete();
  cutters.forEach(c=>c.delete());
 }}
 case 'export':{const asset=p.asset as Asset;const project=p.project as Project;progress('Packaging validated STL files…');const files:Record<string,Uint8Array>={'terrain.stl':stl(asset.terrain),'project.contour.json':strToU8(JSON.stringify(project)),'validation.json':strToU8(JSON.stringify(asset.validation,null,2)),'attribution.txt':strToU8(project.source.attribution+'\nOpenStreetMap data: © OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright\n')};for(const piece of asset.inserts)files[`inserts/${piece.id}.stl`]=stl(piece.mesh);files['insert_manifest.json']=strToU8(JSON.stringify({units:'mm',settings:project.settings,source:project.source,pieces:asset.inserts.map(i=>({file:`${i.id}.stl`,class:i.class,assembly_origin_mm:i.origin}))},null,2));return zipSync(files,{level:3});}
 default:throw new Error('Unknown operation');}}
self.onmessage=async(e:MessageEvent)=>{const {id,type,payload}=e.data;try{const result=await handle(type,payload,message=>self.postMessage({id,progress:message}));const transfers:Transferable[]=[];const visit=(v:any)=>{if(ArrayBuffer.isView(v)){transfers.push(v.buffer as ArrayBuffer);}else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(result);self.postMessage({id,result},[...new Set(transfers)]);}catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}};

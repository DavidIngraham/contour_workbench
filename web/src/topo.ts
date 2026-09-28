import type {Bounds,Layout} from './types';
export function topoProvider(b:Bounds):'usgs'|'global'{const [w,s,e,n]=b;return ((w>=-125&&e<=-66&&s>=24&&n<=49)||(w>=-170&&e<=-130&&s>=51&&n<=72)||(w>=-161&&e<=-154&&s>=18&&n<=23)||(w>=-68&&e<=-64&&s>=17&&n<=19))?'usgs':'global';}
const tileX=(lon:number,z:number)=>(lon+180)/360*2**z;
const tileY=(lat:number,z:number)=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
const lon=(x:number,z:number)=>x/2**z*360-180;
const lat=(y:number,z:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
export async function topoSurface(layout:Layout){
 const b=layout.bounds,dx=b[2]-b[0],dy=b[3]-b[1],region:Bounds=[Math.max(-180,b[0]-dx),Math.max(-85,b[1]-dy),Math.min(180,b[2]+dx),Math.min(85,b[3]+dy)];
 let z=Math.min(15,Math.max(1,Math.floor(Math.log2(1024*360/(256*dx))))),x0=0,x1=0,y0=0,y1=0;
 do{x0=Math.floor(tileX(region[0],z));x1=Math.ceil(tileX(region[2],z));y0=Math.floor(tileY(region[3],z));y1=Math.ceil(tileY(region[1],z));if((x1-x0)*(y1-y0)<=36)break;z--;}while(z>0);
 const provider=topoProvider(b);const canvas=document.createElement('canvas');canvas.width=(x1-x0)*256;canvas.height=(y1-y0)*256;const ctx=canvas.getContext('2d')!;
 const jobs:Array<()=>Promise<void>>=[];let failed=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)jobs.push(async()=>{const image=new Image();image.crossOrigin='anonymous';const url=provider==='usgs'?`https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/${z}/${y}/${x}`:`https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;try{await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=reject;image.src=url;});ctx.drawImage(image,(x-x0)*256,(y-y0)*256);}catch{failed++;}});
 let next=0;await Promise.all(Array.from({length:6},async()=>{while(next<jobs.length)await jobs[next++]();}));
 if(failed)throw new Error('Topographic map tiles could not be loaded. Toggle the map off and on to retry.');
 const xy=(x:number,y:number)=>{const u=(x-b[0])/dx,v=(y-b[1])/dy;return layout.rotated?[(1-v)*layout.width-layout.width/2,u*layout.depth-layout.depth/2]:[u*layout.width-layout.width/2,v*layout.depth-layout.depth/2];};
 const corners=[[lon(x0,z),lat(y1,z)],[lon(x1,z),lat(y1,z)],[lon(x1,z),lat(y0,z)],[lon(x0,z),lat(y0,z)]].map(([x,y])=>xy(x,y));
 return {canvas,corners,provider,attribution:provider==='usgs'?'USGS The National Map':'© OpenStreetMap contributors · SRTM | Map: © OpenTopoMap (CC-BY-SA)'};
}

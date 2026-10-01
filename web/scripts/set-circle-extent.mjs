import {readFile,writeFile} from 'node:fs/promises';

const [inputPath,outputPath,radiusArg,longitudeArg,latitudeArg]=process.argv.slice(2);
if(!inputPath||!outputPath||!radiusArg){
 console.error('Usage: node scripts/set-circle-extent.mjs <input.contour.json> <output.contour.json> <radius-m> [longitude latitude]');
 process.exit(2);
}
const project=JSON.parse(await readFile(inputPath,'utf8'));
const radiusM=Number(radiusArg);
if(!Number.isFinite(radiusM)||radiusM<=0)throw new Error('Radius must be a positive number of meters.');
const prior=project.extent_editor?.center;
const bounds=project.grid?.bounds;
const center=[
 longitudeArg===undefined?(prior?.[0]??(bounds[0]+bounds[2])/2):Number(longitudeArg),
 latitudeArg===undefined?(prior?.[1]??(bounds[1]+bounds[3])/2):Number(latitudeArg)
];
if(!center.every(Number.isFinite))throw new Error('Circle center must contain finite longitude and latitude values.');
const metersPerDegree=111319.490793;
const xScale=metersPerDegree*Math.cos(center[1]*Math.PI/180);
const points=Array.from({length:96},(_,index)=>{
 const angle=index/96*Math.PI*2;
 return [center[0]+Math.cos(angle)*radiusM/xScale,center[1]+Math.sin(angle)*radiusM/metersPerDegree];
});
project.settings={...project.settings,boundary:points};
project.extent_editor={shape:'circle',points,center,width_m:radiusM*2,height_m:radiusM*2,angle_deg:0,corner_radius_m:0};
await writeFile(outputPath,JSON.stringify(project));
console.log(`Updated ${project.name} to a ${radiusM.toLocaleString()} m radius centered at ${center.join(', ')}.`);


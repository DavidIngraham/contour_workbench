/** Select one catalog-listed revision per geographic tile, including archived paths.
 * USGS may put even its newest published revision under /historical/.
 */
export function selectUsgsTiles(items: Array<{downloadURL?:unknown;urls?:Record<string,unknown>}>):string[]{
 const tiles=new Map<string,{url:string;date:string}>();
 for(const item of items){
  const candidate=item.urls?.TIFF||item.downloadURL;
  if(typeof candidate!=='string')continue;
  let url:URL;try{url=new URL(candidate);}catch{continue;}
  if(url.protocol!=='https:'||! /\.tiff?$/i.test(url.pathname))continue;
  const match=url.pathname.match(/\/USGS_(\d+)_([ns]\d+[ew]\d+)(?:_(\d{8}))?\.tiff?$/i);
  const key=match?`${match[1]}:${match[2].toLowerCase()}`:url.pathname;
  const date=match?.[3]||(!url.pathname.includes('/historical/')?'99999999':'00000000');
  const previous=tiles.get(key);
  if(!previous||date>previous.date)tiles.set(key,{url:candidate,date});
 }
 return [...tiles.values()].map(t=>t.url);
}

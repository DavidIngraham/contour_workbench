export interface CrossSectionLike<T> {
 offset(delta:number,joinType:'Round',miterLimit:number,circularSegments:number):T;
 isEmpty():boolean;
 delete():void;
}

export function insetCrossSection<T extends CrossSectionLike<T>>(section:T,insetMm:number,maxRetries=8):{cross:T;owned:boolean;insetMm:number}{
 let attempt=insetMm;
 for(let retry=0;attempt>1e-6&&retry<maxRetries;retry++){
  const candidate=section.offset(-attempt,'Round',2,16);
  if(!candidate.isEmpty())return {cross:candidate,owned:true,insetMm:attempt};
  candidate.delete();attempt*=.5;
 }
 return {cross:section,owned:false,insetMm:0};
}

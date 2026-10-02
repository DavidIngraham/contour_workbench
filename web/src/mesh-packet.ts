import type {Mesh} from './types';

const packetMagic=0x31425743;
const decoder=new TextDecoder();

export interface MeshPacket<T>{metadata:T;meshes:Mesh[]}

export function decodeMeshPacket<T>(packet:Uint8Array):MeshPacket<T>{
 if(packet.byteLength<12)throw new Error('Geometry packet is incomplete.');
 const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
 if(view.getUint32(0,true)!==packetMagic)throw new Error('Geometry packet has an invalid signature.');
 const metadataLength=view.getUint32(4,true),meshCount=view.getUint32(8,true);
 if(meshCount>100_000)throw new Error('Geometry packet contains too many meshes.');
 const tableEnd=12+meshCount*8,metadataEnd=tableEnd+metadataLength,dataStart=(metadataEnd+3)&~3;
 if(tableEnd>packet.byteLength||metadataEnd>packet.byteLength||dataStart>packet.byteLength)throw new Error('Geometry packet header is invalid.');
 let metadata:T;
 try{metadata=JSON.parse(decoder.decode(packet.subarray(tableEnd,metadataEnd))) as T;}catch{throw new Error('Geometry packet metadata is invalid.');}
 const descriptors:Array<[number,number]>=[];let expected=dataStart;
 for(let i=0;i<meshCount;i++){
  const positionsLength=view.getUint32(12+i*8,true),indicesLength=view.getUint32(16+i*8,true);
  if(positionsLength%3||indicesLength%3)throw new Error('Geometry packet contains an invalid mesh.');
  const bytes=(positionsLength+indicesLength)*4;
  if(!Number.isSafeInteger(bytes)||expected+bytes>packet.byteLength)throw new Error('Geometry packet mesh data is incomplete.');
  descriptors.push([positionsLength,indicesLength]);expected+=bytes;
 }
 if(expected!==packet.byteLength)throw new Error('Geometry packet has trailing data.');
 let offset=dataStart;
 const typed=<TArray extends Float32Array|Uint32Array>(kind:'float'|'uint',length:number):TArray=>{
  const Ctor=kind==='float'?Float32Array:Uint32Array,start=packet.byteOffset+offset,bytes=length*4;
  const value=(start%4===0?new Ctor(packet.buffer,start,length):new Ctor(packet.slice(offset,offset+bytes).buffer)) as TArray;
  offset+=bytes;return value;
 };
 const meshes=descriptors.map(([positionsLength,indicesLength])=>({
  positions:typed<Float32Array>('float',positionsLength),
  indices:typed<Uint32Array>('uint',indicesLength),
 }));
 return {metadata,meshes};
}

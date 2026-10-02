import {describe,expect,it} from 'vitest';
import {decodeMeshPacket} from '../src/mesh-packet';

function packet(metadata:unknown,positions:number[],indices:number[]){
 const encoded=new TextEncoder().encode(JSON.stringify(metadata)),tableEnd=20,dataStart=(tableEnd+encoded.length+3)&~3;
 const bytes=new Uint8Array(dataStart+(positions.length+indices.length)*4),view=new DataView(bytes.buffer);
 view.setUint32(0,0x31425743,true);view.setUint32(4,encoded.length,true);view.setUint32(8,1,true);
 view.setUint32(12,positions.length,true);view.setUint32(16,indices.length,true);bytes.set(encoded,tableEnd);
 new Float32Array(bytes.buffer,dataStart,positions.length).set(positions);
 new Uint32Array(bytes.buffer,dataStart+positions.length*4,indices.length).set(indices);
 return bytes;
}

describe('mesh packet',()=>{
 it('decodes metadata and zero-copy typed mesh views',()=>{
  const bytes=packet({name:'terrain'},[1,2,3],[0,0,0]),decoded=decodeMeshPacket<{name:string}>(bytes);
  expect(decoded.metadata).toEqual({name:'terrain'});
  expect([...decoded.meshes[0].positions]).toEqual([1,2,3]);
  expect([...decoded.meshes[0].indices]).toEqual([0,0,0]);
  expect((decoded.meshes[0].positions as Float32Array).buffer).toBe(bytes.buffer);
 });
 it('rejects truncated packets',()=>{
  expect(()=>decodeMeshPacket(packet({},[1,2,3],[0,0,0]).subarray(0,24))).toThrow(/incomplete/);
 });
});

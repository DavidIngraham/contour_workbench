import {describe,expect,it} from 'vitest';
import {insetCrossSection,shouldTaperInsert,type CrossSectionLike} from '../src/insert-taper';

class FakeSection implements CrossSectionLike<FakeSection>{
 deleted=false;
 constructor(readonly empty:boolean,readonly children:FakeSection[]=[]){}
 offset(){if(this.deleted)throw new Error('offset called on deleted section');const child=new FakeSection(this.empty);this.children.push(child);return child;}
 isEmpty(){if(this.deleted)throw new Error('isEmpty called on deleted section');return this.empty;}
 delete(){if(this.deleted)throw new Error('section deleted twice');this.deleted=true;}
}

describe('insert taper cross sections',()=>{
 it('skips taper booleans for exceptionally complex continuous networks',()=>{
  expect(shouldTaperInsert(10_000*3)).toBe(true);
  expect(shouldTaperInsert(10_000*3+3)).toBe(false);
 });
 it('falls back to the live source after every inset collapses',()=>{
  const source=new FakeSection(true),result=insetCrossSection(source,.2);
  expect(result).toEqual({cross:source,owned:false,insetMm:0});
  expect(source.deleted).toBe(false);
  expect(source.children).toHaveLength(8);
  expect(source.children.every(child=>child.deleted)).toBe(true);
  expect(()=>result.cross.isEmpty()).not.toThrow();
 });
 it('returns the first viable inset without deleting it',()=>{
  const source=new FakeSection(false),result=insetCrossSection(source,.2);
  expect(result.owned).toBe(true);
  expect(result.insetMm).toBe(.2);
  expect(result.cross).not.toBe(source);
  expect(result.cross.deleted).toBe(false);
 });
});

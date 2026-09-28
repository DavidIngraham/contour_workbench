import {describe,it,expect} from 'vitest';
import {selectUsgsTiles} from '../src/usgs-catalog';
const tile=(name:string)=>({downloadURL:`https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/historical/n46w122/${name}.tif`});
describe('USGS catalog tile revisions',()=>{
 it('keeps the newest Post Canyon tile even when all versions are archived',()=>{
 const entries=['20121001','20211129','20260202','20171026'].map(d=>tile(`USGS_13_n46w122_${d}`));
 expect(selectUsgsTiles(entries)).toEqual([entries[2].downloadURL]);
 });
 it('keeps neighboring tiles and separates resolutions',()=>{
 const entries=[tile('USGS_13_n46w122_20260202'),tile('USGS_13_n46w123_20240101'),tile('USGS_1_n46w122_20240101')];expect(selectUsgsTiles(entries)).toHaveLength(3);
 });
 it('prefers the current alias when the catalog provides one',()=>{
 const current={downloadURL:'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n46w122/USGS_13_n46w122.tif'};
 expect(selectUsgsTiles([tile('USGS_13_n46w122_20260202'),current])).toEqual([current.downloadURL]);
 });
 it('accepts TIFF alternatives and query strings but rejects unsupported downloads',()=>{
 expect(selectUsgsTiles([{urls:{TIFF:'https://example.com/USGS_13_n46w122_20260202.tif?version=1'}},{downloadURL:'https://example.com/file.zip'},{downloadURL:'broken'}])).toEqual(['https://example.com/USGS_13_n46w122_20260202.tif?version=1']);
 });
});

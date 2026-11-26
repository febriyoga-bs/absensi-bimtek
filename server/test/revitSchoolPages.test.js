import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchCompleteSchoolPages} from '../src/revitSchoolPages.js';
const rows=Array.from({length:5},(_,i)=>({npsn:String(10000000+i)}));
test('all venues fit in one upstream request when a larger page size is supported',async()=>{
 const calls=[];
 const result=await fetchCompleteSchoolPages(async(...args)=>{calls.push(args);return {total:5,rows};},'bio_ok');
 assert.deepEqual(result,rows);assert.deepEqual(calls,[['',1,'bio_ok',2000]]);
});
test('ignored or capped per_page continues through every actual page',async()=>{
 const calls=[];
 const result=await fetchCompleteSchoolPages(async(hotel,page,metric,perPage)=>{
 calls.push(page);assert.equal(hotel,'');assert.equal(perPage,2000);
 return {total:5,rows:rows.slice((page-1)*2,page*2)};
 });
 assert.deepEqual(result,rows);assert.deepEqual(calls,[1,2,3]);
});
test('repeated page, changed totals and missing rows fail instead of returning partial rankings',async()=>{
 await assert.rejects(fetchCompleteSchoolPages(async()=>({total:5,rows:rows.slice(0,2)})),/berubah|lengkap/);
 await assert.rejects(fetchCompleteSchoolPages(async(_,page)=>({total:page===1?5:4,rows:rows.slice(0,2)})),/berubah/);
 await assert.rejects(fetchCompleteSchoolPages(async(_,page)=>({total:5,rows:page===1?rows.slice(0,2):[]})),/lengkap/);
 await assert.rejects(fetchCompleteSchoolPages(async()=>({total:2,rows:[rows[0],rows[0]]})),/berulang/);
});
test('empty stages do not trigger extra page requests',async()=>{
 let count=0;assert.deepEqual(await fetchCompleteSchoolPages(async()=>{count++;return {total:0,rows:[]};}),[]);
 assert.equal(count,1);
});

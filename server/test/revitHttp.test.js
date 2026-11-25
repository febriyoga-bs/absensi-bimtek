import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevitReader } from '../src/revitHttp.js';

test('temporary Revit failures retry, and successful concurrent reads share one request', async () => {
  let calls = 0;
  const read = createRevitReader({ fetchPage: async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 503 } : { ok: true, text: async () => '<table>Revit</table>' };
  } });
  const values = await Promise.all([read('https://example.org/revit'), read('https://example.org/revit')]);
  assert.deepEqual(values, ['<table>Revit</table>', '<table>Revit</table>']);
  assert.equal(calls, 2);
  await read('https://example.org/revit');
  assert.equal(calls, 2);
});

test('upstream errors remain visible and are not cached as school data', async () => {
  let fail = true;
  const read = createRevitReader({ fetchPage: async () => fail ? { ok: false, status: 404 }
    : { ok: true, text: async () => 'recovered' } });
  await assert.rejects(read('https://example.org/revit'), /HTTP 404/);
  fail = false;
  assert.equal(await read('https://example.org/revit'), 'recovered');
});

test('network failures receive a bounded retry and do not leave a stuck pending request', async () => {
  let calls = 0;
  const read = createRevitReader({ fetchPage: async () => { calls++; throw new Error('timeout'); } });
  await assert.rejects(read('https://example.org/revit'), /Tidak dapat mengambil/);
  assert.equal(calls, 2);
  await assert.rejects(read('https://example.org/revit'));
  assert.equal(calls, 4);
});
test('429 respects Retry-After across different page URLs without immediate retries',async()=>{
 let time=1000,calls=0;
 const read=createRevitReader({now:()=>time,interval:0,pause:async()=>{},fetchPage:async()=>{
  calls++;
  return calls===1?{ok:false,status:429,headers:{get:()=> '45'}}:{ok:true,text:async()=> 'recovered'};
 }});
 await assert.rejects(read('https://example.org/page1'),/429/);
 await assert.rejects(read('https://example.org/page2'),/45 detik/);
 assert.equal(calls,1);
 time+=45001;
 assert.equal(await read('https://example.org/page2'),'recovered');
 assert.equal(calls,2);
});
test('different pages queue upstream requests rather than sending a burst',async()=>{
 let active=0,max=0;
 const read=createRevitReader({interval:0,pause:async()=>{},fetchPage:async()=>{
  active++;max=Math.max(max,active);await Promise.resolve();active--;
  return {ok:true,text:async()=> 'page'};
 }});
 await Promise.all(['a','b','c'].map(p=>read(`https://example.org/${p}`)));
 assert.equal(max,1);
});

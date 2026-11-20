import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparePdfResume,cachedPdfPhoto,prepareVenuePdfBatch} from './pdfResume.js';
test('retry reuses successful photos and resumes only the failed photo',async()=>{
 const s=preparePdfResume({},'scope-a');let first=0,second=0;
 await cachedPdfPhoto(s,'1',async()=>{first++;return 'photo1';});
 await assert.rejects(cachedPdfPhoto(s,'2',async()=>{second++;throw Error('offline');},{wait:async()=>{}}));
 assert.equal(second,3);assert.equal(s.photos.size,1);
 preparePdfResume(s,'scope-a');
 assert.equal(await cachedPdfPhoto(s,'1',async()=>{first++;return 'changed';}),'photo1');
 assert.equal(await cachedPdfPhoto(s,'2',async()=>{second++;return 'photo2';}),'photo2');
 assert.equal(first,1);assert.equal(second,4);
});
test('changing filters or account clears resumable data; permanent errors do not retry',async()=>{
 const s=preparePdfResume({},'a');s.photos.set('1','old');s.records.push({id:1});s.dataComplete=true;
 preparePdfResume(s,'b');assert.equal(s.photos.size,0);assert.equal(s.records.length,0);assert.equal(s.dataComplete,false);
 let calls=0;await assert.rejects(cachedPdfPhoto(s,'1',async()=>{calls++;throw Object.assign(Error('forbidden'),{retryable:false});}));assert.equal(calls,1);
});

test('venue batch retains completed files across retries but clears them for different filters',()=>{
 const state=prepareVenuePdfBatch({},'filter-1');state.completedVenues.set('1',{name:'Venue 1.pdf'});state.emptyVenues.add('2');
 assert.equal(prepareVenuePdfBatch(state,'filter-1').completedVenues.size,1);
 prepareVenuePdfBatch(state,'filter-2');assert.equal(state.completedVenues.size,0);assert.equal(state.emptyVenues.size,0);
});

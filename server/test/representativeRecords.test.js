import {test} from 'node:test';
import assert from 'node:assert/strict';
import {representativeMatcher,representativeAttendance} from '../src/representativeRecords.js';
import {arrivedAtVenue} from '../../shared/venueArrival.js';
const entry=(name,npsn)=>({name,npsn,people:[{name,registered:false,status:null}]});
test('indexed matching uses names and NPSNs, never transfers ambiguous attendance',()=>{
 const entries=[entry('Ani','1'),entry('Ani','2'),entry('Budi','3')],match=representativeMatcher(entries);
 assert.equal(match({name:'ANI',npsn:'2'}),entries[1]);
 assert.equal(match({name:'Ani'}),null);
 assert.equal(match({name:'Ani',npsn:'4'}),null);
 assert.equal(match({name:'Original',original_name:'BUDI',npsn:'3'}),entries[2]);
 assert.equal(match({name:'Ani',original_name:'Budi',npsn:'2;3'}),null);
});
test('one attendance record links once; duplicates stay unresolved and input is unchanged',()=>{
 const entries=[entry('Ani','1'),entry('Budi','2')];
 const result=representativeAttendance(entries,[{name:'Ani',npsn:'1',status:'valid'},{name:'Budi',npsn:'2',status:'review'},{name:'Budi',npsn:'2',status:'valid'}]);
 assert.equal(result[0].people[0].status,'valid');
 assert.equal(result[1].people[0].registered,false);
 assert.equal(entries[0].people[0].status,null);
});
test('bulk representative matching handles a full venue without repeated scans',()=>{
 const entries=Array.from({length:600},(_,i)=>entry(`Person ${i}`,String(i)));
 const records=entries.map((e,i)=>({name:e.name,npsn:e.npsn,status:i%2?'berhalangan':'valid'}));
 const result=representativeAttendance(entries,records);
 assert.equal(result.length,600);
 assert.equal(result.filter(e=>e.people[0].registered).length,600);
});
test('card target and popup scope exclude confirmed participants who have not arrived',()=>{
 const entries=['selesai','sudah_tiba','sedang_antre','belum_tiba',null].map((status,i)=>({
   name:`Person ${i}`,people:[{arrival_status:status,status:i===0?'valid':null}],
 }));
 const visible=entries.filter(arrivedAtVenue);
 assert.equal(visible.length,3);
 assert.equal(visible.filter(e=>e.people.some(p=>p.status==='valid')).length,1);
 assert.equal(visible.filter(e=>!e.people.some(p=>p.status==='valid')).length,2);
 assert.equal(arrivedAtVenue({people:[]}),false);
});

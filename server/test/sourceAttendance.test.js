import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceAttendance} from '../src/sourceAttendance.js';
const profile=(id,name,institution,venue_id=1)=>({id,name,institution,venue_id,position:'Pengawas',status_by_venue:{1:'valid'}});
const source=(rows,invited=rows.length)=>({venue_id:1,source_summary:[{position:'Pengawas',invited}],detail_rows:rows.map(([name,institution])=>({name,institution,position:'Pengawas',arrival_status:'selesai'}))});
test('invitation source controls target and details; extra profiles and wrong venues never count',()=>{
 const r=sourceAttendance(source([['Ani','Sekolah A'],['Baru','Sekolah B']],413),[profile(1,'Ani','Sekolah A'),profile(2,'Di luar sumber','Lain'),profile(3,'Baru','Sekolah B',2)],'pengawas');
 assert.equal(r.count.total,413);assert.equal(r.count.attended,1);assert.equal(r.count.registered,1);assert.equal(r.count.unresolved,1);assert.equal(r.details.length,2);
});
test('exact duplicate source entries count once; distinct names sharing one profile are unresolved',()=>{
 const r=sourceAttendance(source([['Ani','Sekolah A'],['Ani','Sekolah A'],['Pengganti','Sekolah A']]),[profile(1,'Ani','Sekolah A')],'pengawas');
 assert.equal(r.details.length,2);assert.equal(r.count.attended,0);assert.equal(r.count.unresolved,2);
});
test('ambiguous school identities cannot transfer attendance; exact name can disambiguate',()=>{
 const ps=[profile(1,'Ani','Sama'),profile(2,'Budi','Sama')].map(p=>({...p,position:'Bendahara'}));
 const s={venue_id:1,source_summary:[{position:'Bendahara',invited:2}],detail_rows:[{position:'Bendahara',name:'Budi',institution:'Sama'},{position:'Bendahara',name:'Pengganti',institution:'Lain'}]};
 const r=sourceAttendance(s,ps,'bendahara');assert.equal(r.count.attended,1);assert.equal(r.count.unresolved,1);
 assert.equal(sourceAttendance({detail_rows:[]},ps,'bendahara'),null);
});

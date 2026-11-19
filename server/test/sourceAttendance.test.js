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

test('recorded includes attendance and unavailable once, excluding missing and rejected records',()=>{
 const names=['Hadir','Cek','Berhalangan','Belum','Ditolak'];
 const statuses=['valid','review','berhalangan',null,'rejected'];
 const ps=names.map((name,i)=>({...profile(i+1,name,`Sekolah ${i}`),status_by_venue:{1:statuses[i]}}));
 const r=sourceAttendance(source(names.map((name,i)=>[name,`Sekolah ${i}`])),ps,'pengawas');
 assert.equal(r.count.total,5);assert.equal(r.count.attended,2);assert.equal(r.count.recorded,3);
 assert.equal(r.details.find(row=>row.name==='Berhalangan').people[0].status,'berhalangan');
});

test('same NPSN and similar name links a profile despite school spelling differences',()=>{
 const s=source([['Sri Rahayu Pm','UPT SPF SD INPRES HARTACO INDAH']]);s.detail_rows[0].npsn='40312039';
 const ps=[{...profile(1,'SRI RAHAYU PM., S.PD. Gr.','SD INPRES HARTACO INDAH'),npsn:'40312039'}];
 assert.equal(sourceAttendance(s,ps,'pengawas').count.recorded,1);
 s.detail_rows[0].npsn='99999999';assert.equal(sourceAttendance(s,ps,'pengawas').count.recorded,0);
});
test('without NPSN, normalized school and similar name can link; ambiguous or unrelated names cannot',()=>{
 const s=source([['Sri Rahayu Pm','UPT SPF SD INPRES HARTACO INDAH']]);
 const p=profile(1,'SRI RAHAYU PM., S.PD. Gr.','SD INPRES HARTACO INDAH');
 assert.equal(sourceAttendance(s,[p],'pengawas').count.recorded,1);
 assert.equal(sourceAttendance(s,[p,{...p,id:2}],'pengawas').count.recorded,0);
 assert.equal(sourceAttendance(s,[{...p,name:'Peserta Lain'}],'pengawas').count.recorded,0);
 assert.equal(sourceAttendance(s,[{...p,venue_id:2}],'pengawas').count.recorded,0);
});

test('explicit unconfirmed source rows are excluded while confirmed pending arrivals remain',()=>{
 const s=source([['Belum','A'],['Bersedia','B'],['Tiba','C']]);
 s.detail_rows[0].confirmation_status='Belum Konfirmasi';
 s.detail_rows[1].confirmation_status='Bersedia Hadir';s.detail_rows[1].arrival_status=null;
 const r=sourceAttendance(s,[],'pengawas');
 assert.deepEqual(r.details.map(row=>row.name),['Bersedia','Tiba']);
});

test('explicit source link accepts representative with different school spelling within the same venue and category',()=>{
 const s=source([['Ahmad Abdul Azis','SD NEGERI PANJANG III']]);s.detail_rows[0].profile_id=1;
 const p=profile(1,'Nanil Liana Indah Arera','SD NEGERI PANJANG III KEDUNGADEM');
 assert.equal(sourceAttendance(s,[p],'pengawas').count.recorded,1);
 assert.equal(sourceAttendance(s,[{...p,venue_id:2}],'pengawas').count.recorded,0);
});

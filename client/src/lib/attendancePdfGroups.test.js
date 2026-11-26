import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendancePdfGroups,attendancePdfCategorySummary,attendancePdfSections,attendancePdfName,attendancePdfPosition} from './attendancePdfGroups.js';
import {setSelectedEvent} from '../event.js';
test('PDF separates present, unavailable and rejected records without dropping any',()=>{
 const records=['valid','berhalangan','review','ditolak'].map((status,id)=>({status,id}));
 const groups=attendancePdfGroups(records);
 assert.deepEqual(groups.map(group=>group.rows.map(row=>row.id)),[[0,2],[1],[3]]);
 assert.equal(groups.flatMap(group=>group.rows).length,records.length);
});

test('category summary includes five requested roles and deduplicates a person across sessions',()=>{
 const rows=[{person_id:1,position:'Bendahara',status:'valid'},{person_id:1,position:'Bendahara',status:'valid'},
 {person_id:2,position:'Kepala Sekolah',status:'berhalangan'},{person_id:3,position:'Verifikator',status:'valid'},
 {person_id:4,position:'Bendahara',representative:{name:'Attendee',role:'Perwakilan Sekolah'},status:'ditolak'},
 {person_id:5,position:'LO',status:'review'}];
 const summary=attendancePdfCategorySummary(rows);
 assert.equal(summary.length,5);
 assert.deepEqual(summary.map(r=>r.label),['Kepala Sekolah','Bendahara','Perwakilan Sekolah','Verifikator','LO']);
 assert.deepEqual(summary.map(r=>[r.hadir,r.berhalangan,r.lainnya,r.total]),[[0,1,0,1],[1,0,0,1],[0,0,1,1],[1,0,0,1],[1,0,0,1]]);
});

test('verifiers follow LO and school participants are sorted by school before their names',()=>{
 const rows=[{id:1,name:'Aaron',institution:'SD Z',position:'Bendahara',status:'valid'},
 {id:2,name:'Zahra',institution:'SD A',position:'Kepala Sekolah',status:'valid'},
 {id:3,name:'Verifier',position:'Verifikator',status:'valid'},
 {id:4,name:'Liaison',position:'LO',status:'valid'},
 {id:5,name:'Absent',institution:'SD A',position:'Bendahara',status:'berhalangan'}];
 const sections=attendancePdfSections(rows);
 assert.deepEqual(sections.map(s=>s.label),['LO - Hadir','Verifikator - Hadir','Peserta - Hadir','Peserta - Berhalangan Hadir']);
 assert.deepEqual(sections.flatMap(s=>s.rows.map(r=>r.id)),[4,3,2,1,5]);
 assert.equal(rows[0].id,1,'input records are not reordered');
});

test('PKS legacy labels and school representatives use the actual attendee identity',()=>{
 setSelectedEvent({id:5});
 try {
  const row={name:'Original',position:'Bendahara',representative:{name:'ACTUAL ATTENDEE',role:'Perwakilan Sekolah'}};
  assert.equal(attendancePdfName(row),'Actual Attendee');
  assert.equal(attendancePdfPosition(row),'Perwakilan Sekolah');
  assert.equal(attendancePdfCategorySummary([row]).find(r=>r.key==='perwakilan').total,1);
  assert.equal(attendancePdfPosition({position:'Pengawas'}),'Kepala Sekolah');
  assert.equal(attendancePdfPosition({position:'Fasilitator'}),'Verifikator');
 } finally { setSelectedEvent(null); }
});

test('detail sections show all LO before participants while separating present and unavailable',()=>{
 const records=[{id:1,position:'Bendahara',status:'valid'},{id:2,position:'LO',status:'berhalangan'},
 {id:3,position:'LO',status:'valid'},{id:4,position:'Pengawas',status:'berhalangan'}];
 const sections=attendancePdfSections(records);
 assert.deepEqual(sections.map(s=>s.rows.map(r=>r.id)),[[3],[2],[1],[4]]);
 assert.equal(sections[0].label,'LO - Hadir');
});

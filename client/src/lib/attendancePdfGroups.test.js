import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendancePdfGroups,attendancePdfCategorySummary,attendancePdfSections} from './attendancePdfGroups.js';
test('PDF separates present, unavailable and rejected records without dropping any',()=>{
 const records=['valid','berhalangan','review','ditolak'].map((status,id)=>({status,id}));
 const groups=attendancePdfGroups(records);
 assert.deepEqual(groups.map(group=>group.rows.map(row=>row.id)),[[0,2],[1],[3]]);
 assert.equal(groups.flatMap(group=>group.rows).length,records.length);
});

test('category summary includes five requested roles and deduplicates a person across sessions',()=>{
 const rows=[{person_id:1,position:'Bendahara',status:'valid'},{person_id:1,position:'Bendahara',status:'valid'},
 {person_id:2,position:'Pengawas',status:'berhalangan'},{person_id:3,position:'Fasilitator Pelaporan',status:'valid'},
 {person_id:4,position:'Dinas Pendidikan',status:'ditolak'},{person_id:5,position:'BB/BPMP',status:'review'}];
 const summary=attendancePdfCategorySummary(rows);
 assert.equal(summary.length,5);
 assert.deepEqual(summary.map(r=>[r.hadir,r.berhalangan,r.lainnya,r.total]),[[1,0,0,1],[0,1,0,1],[1,0,0,1],[0,0,1,1],[1,0,0,1]]);
});

test('detail sections show all LO before participants while separating present and unavailable',()=>{
 const records=[{id:1,position:'Bendahara',status:'valid'},{id:2,position:'LO',status:'berhalangan'},
 {id:3,position:'LO',status:'valid'},{id:4,position:'Pengawas',status:'berhalangan'}];
 const sections=attendancePdfSections(records);
 assert.deepEqual(sections.map(s=>s.rows.map(r=>r.id)),[[3],[2],[1],[4]]);
 assert.equal(sections[0].label,'LO - Hadir');
});

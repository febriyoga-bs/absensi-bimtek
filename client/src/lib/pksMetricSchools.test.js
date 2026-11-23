import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schoolsForBimtekMetric,summarizeBimtek} from '../../../shared/pksBimtek.js';
test('popup membership exactly matches metric counts and deduplicates NPSNs',()=>{
 const schools=[{npsn:'1',bimtek:{document_status:'lengkap',rab_status:'sesuai'},pks:{status:'lengkap'}},
 {npsn:'2',bimtek:{document_status:'perlu_perbaikan',rab_status:'diajukan'},pks:{status:'perlu_perbaikan'}},
 {npsn:'3',bimtek:null,pks:{status:'belum_diterima'}}];
 const duplicated=[...schools,schools[0]],counts=summarizeBimtek(duplicated);
 for(const [key,count] of Object.entries(counts))assert.equal(schoolsForBimtekMetric(duplicated,key).length,count);
 assert.deepEqual(schoolsForBimtekMetric(schools,'followup').map(s=>s.npsn),['2']);
 assert.deepEqual(schoolsForBimtekMetric(schools,'reviewed').map(s=>s.npsn),['1']);
 assert.deepEqual(schoolsForBimtekMetric([schools[2]],'complete'),[]);
 assert.deepEqual(schoolsForBimtekMetric([],'total'),[]);
});

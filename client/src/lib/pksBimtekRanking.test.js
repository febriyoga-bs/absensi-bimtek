import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankBimtekOwners} from './pksBimtekRanking.js';
test('overall uses four positive milestones; ties share rank and unassigned owners have none',()=>{
 const owners=['A','B','C','D'].map(name=>({name,venue:'Hotel'}));
 const schools=[{npsn:'1',lo:'A',venue:'Hotel',bimtek:{document_status:'lengkap',rab_status:'sesuai'},pks:{status:'lengkap'}},
 {npsn:'2',lo:'B',venue:'Hotel',bimtek:{document_status:'lengkap',rab_status:'perlu_perbaikan'}},
 {npsn:'3',lo:'C',venue:'Hotel',bimtek:{document_status:'lengkap',rab_status:'diajukan'}}];
 const rows=rankBimtekOwners(schools,owners);
 assert.deepEqual(rows.map(r=>r.overall),[100,50,50,null]);
 assert.deepEqual(rows.map(r=>r.rank),[1,2,2,null]);
 assert.equal(rankBimtekOwners(schools,owners,'Lain').length,0);
});

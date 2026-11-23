import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schoolInspectionItems} from './pksInspection.js';
test('school results show all five indicators and retain unknown states',()=>{
 const items=schoolInspectionItems({bimtek:null,pks:{status:'belum_diterima'}});
 assert.equal(items.length,5);
 assert.deepEqual(items.map(item=>item.metric),['documents','submitted','reviewed','followup','complete']);
 assert.equal(items[2].status,'Belum dicatat');
 assert.equal(items[3].status,'Belum dicatat');
 assert.equal(items[4].status,'Belum diterima');
});
test('review and correction results do not imply PKS completion',()=>{
 const items=schoolInspectionItems({bimtek:{document_status:'lengkap',rab_status:'perlu_perbaikan'},pks:{status:'menunggu_verifikasi'}});
 assert.equal(items[0].status,'Lengkap');
 assert.equal(items[2].status,'Perlu perbaikan');
 assert.equal(items[3].status,'Perlu perbaikan');
 assert.equal(items[4].status,'Menunggu verifikasi');
});

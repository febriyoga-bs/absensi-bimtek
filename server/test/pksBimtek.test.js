import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanBimtekRecord} from '../src/pksBimtek.js';
import {documentsComplete,requiredDocuments,summarizeBimtek} from '../../shared/pksBimtek.js';
const draft={school_type:'negeri',assistance_types:['school_kit'],documents:{data_sekolah:true,sk_tim:true},rab_status:'belum_diajukan'};
test('document requirements depend on school status and assistance type; missing data is not complete',()=>{
 assert.equal(documentsComplete(),false);
 assert.equal(documentsComplete(null),false);
 assert.deepEqual(requiredDocuments(null),['data_sekolah','sk_tim']);
 assert.equal(documentsComplete(draft),true);
 const special={...draft,school_type:'swasta',assistance_types:['rkd']};
 assert.deepEqual(requiredDocuments(special),['data_sekolah','sk_tim','izin_operasional','kesiapan']);
 assert.equal(documentsComplete(special),false);
 assert.equal(documentsComplete({...special,documents:{...draft.documents,izin_operasional:true,kesiapan:true}}),true);
});
test('RAB submissions require evidence and reviews require admin and named dated results',()=>{
 assert.equal(cleanBimtekRecord(draft,false).rab_status,'belum_diajukan');
 assert.throws(()=>cleanBimtekRecord({...draft,rab_status:'diajukan'},false),{status:400});
 const submitted={...draft,rab_status:'diajukan',submitted_on:'2026-11-24',internal_check:true,price_survey:true,evidence_url:'https://example.org/rab'};
 assert.equal(cleanBimtekRecord(submitted,false).rab_status,'diajukan');
 assert.throws(()=>cleanBimtekRecord({...submitted,evidence_url:'javascript:alert(1)'},false),{status:400});
 assert.throws(()=>cleanBimtekRecord({...submitted,rab_status:'sesuai'},false),{status:403});
 assert.throws(()=>cleanBimtekRecord({...submitted,rab_status:'sesuai'},true),{status:400});
 assert.equal(cleanBimtekRecord({...submitted,rab_status:'sesuai',reviewer:'Verifikator',reviewed_on:'2026-11-24',note:'Hasil reviu sesuai'},true).reviewer,'Verifikator');
 assert.throws(()=>cleanBimtekRecord({...submitted,submitted_on:'2026-02-30'},true),{status:400});
});
test('summaries count distinct NPSNs and keep PKS and RAB outcomes separate',()=>{
 const schools=[{npsn:'1',bimtek:draft,pks:{status:'lengkap'}},{npsn:'2',bimtek:{...draft,rab_status:'perlu_perbaikan'},pks:{status:'perlu_perbaikan'}}];
 assert.deepEqual(summarizeBimtek([...schools,schools[0]]),{total:2,documents:2,submitted:1,reviewed:0,followup:1,complete:1});
 assert.equal(summarizeBimtek([{npsn:'3'}]).documents,0);
 assert.deepEqual(summarizeBimtek([{npsn:'3',bimtek:null,pks:{status:'belum_diterima'}}]),{total:1,documents:0,submitted:0,reviewed:0,followup:0,complete:0});
});

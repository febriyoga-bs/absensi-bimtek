import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditSchoolIdentities} from '../src/auditSchoolIdentities.js';
test('audit detects head on treasurer and duplicated bindings within NPSN and venue only',()=>{
 const school={npsn:'10103040',name:'SD Example',venue:'Lumire Jakarta',head_name:'Basaruddin',arrival_attendees:[]};
 const profiles=[{id:1,name:'Basaruddin',position:'Kepala Sekolah',npsn:school.npsn,venue_id:1,venue:school.venue},
  {id:2,name:'Bendahara - SD Example',position:'Bendahara',npsn:school.npsn,venue_id:1,venue:school.venue},
  {id:3,name:'Basaruddin',position:'Bendahara',npsn:'99999999',venue_id:1,venue:school.venue}];
 const findings=auditSchoolIdentities([school],profiles,[{venue_id:1,representatives:{2:{name:'Basaruddin'}}}]);
 assert.deepEqual(findings.map(f=>f.type),['HEAD_ON_TREASURER','DUPLICATE_PROFILE_NAME']);
 assert.ok(findings.every(f=>f.npsn===school.npsn));
});
test('unresolved source names are candidates, not confirmed data errors',()=>{
 const [finding]=auditSchoolIdentities([{npsn:'10103040',name:'SD Example',venue:'Hotel',head_name:'Old head',
  arrival_attendees:[{name:'New name',role:'Perwakilan Sekolah',status:'selesai'}]}]);
 assert.equal(finding.type,'UNRESOLVED_HEAD_IDENTITY');
 assert.match(finding.evidence,/belum terbukti salah/);
});

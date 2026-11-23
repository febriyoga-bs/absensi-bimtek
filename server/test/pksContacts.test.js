import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planPksContacts} from '../src/pksContacts.js';
const row={A:'12345678',E:'Hotel',H:'Kepsek',I:'081234567890',L:'Koor',N:'081234567891',O:'koor@example.org',P:'Verifikator',R:'081234567892',S:'verif@example.org'};
const roster={schools:[{npsn:'12345678',venue:'Hotel',head_name:'Kepsek',coordinator:'Koor',facilitator:'Verifikator'}],coordinators:[{name:'Koor',venue:'Hotel'}],facilitators:[{name:'Verifikator',venue:'Hotel',coordinator:'Koor'}],pks_records:{'12345678':{status:'lengkap'}},lo:[{name:'LO'}]};
test('reads scientific-notation NPSNs from Excel without dropping contact rows',()=>{
 const plan=planPksContacts([{...row,A:'1.2345678E7'}],roster,[],[]);
 assert.equal(plan.roster.schools[0].head_phone,row.I);
 assert.equal(plan.roster.facilitators[0].phone,row.R);
 assert.equal(plan.roster.coordinators[0].phone,row.N);
});
test('fills contacts by NPSN and venue/name without changing assignments or PKS status',()=>{
 const people=[{id:1,name:'Kepsek',position:'Kepala Sekolah',npsn:'12345678',venue_id:1},{id:2,name:'Verifikator',position:'Verifikator',venue_id:1},{id:3,name:'Kepsek pengganti',position:'Kepala Sekolah',npsn:'12345678',venue_id:1},{id:4,name:'Verifikator',position:'Verifikator',venue_id:2}];
 const plan=planPksContacts([row],roster,people,[{id:1,name:'Hotel'},{id:2,name:'Lain'}]);
 assert.deepEqual(plan.updates,[{id:1,phone:row.I},{id:2,phone:row.R}]);
 assert.equal(plan.roster.schools[0].coordinator_phone,row.N);
 assert.equal(plan.roster.facilitators[0].email,row.S);
 assert.deepEqual(plan.roster.pks_records,roster.pks_records);
 assert.deepEqual(plan.roster.lo,roster.lo);
 assert.equal(roster.schools[0].head_phone,undefined);
});
test('preserves existing numbers and skips conflicting source contacts',()=>{
 const existing=structuredClone(roster);existing.schools[0].head_phone='081111111111';
 const plan=planPksContacts([row,{...row,R:'089999999999'}],existing,[],[]);
 assert.equal(plan.roster.schools[0].head_phone,'081111111111');
 assert.equal(plan.roster.facilitators[0].phone,undefined);
 assert.ok(plan.summary.issues.length>0);
});

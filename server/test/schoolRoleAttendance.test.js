import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schoolRoleAttendance} from '../src/schoolRoleAttendance.js';
test('recorded counts unique arrived targets, excluding other roles and pending arrivals',()=>{
 const schools=[{npsn:'1',arrival_attendees:[{name:'Ani',role:'Bendahara',status:'selesai'}]},
 {npsn:'2',arrival_attendees:[{name:'Budi',role:'Bendahara',status:'belum_tiba'}]},
 {npsn:'3',arrival_attendees:[{name:'Citra',role:'Perwakilan Sekolah',status:'selesai'}]}];
 const records=[{npsn:'1',name:'Ani',status:'valid'},{npsn:'1',name:'Ani',status:'review'},
 {npsn:'2',name:'Budi',status:'berhalangan'},{npsn:'3',name:'Citra',status:'valid'}];
 assert.deepEqual(schoolRoleAttendance(schools,'Bendahara',records),{arrivalTarget:1,recorded:1});
});
test('an unnamed treasurer attendance stays counted in a unique arrived NPSN role target after reimport',()=>{
 const schools=[{npsn:'10102066',name:'SDN ALUE PUNTI',arrival_attendees:[
  {name:'Edi Saputra',role:'Kepala Sekolah',status:'selesai'},
  {name:'Koko Susilo',role:'Bendahara',status:'selesai'}]}];
 const record={person_id:7,npsn:'10102066',name:'Bendahara — SDN Alue Punti',original_name:'Bendahara — SDN Alue Punti',position:'Bendahara',status:'valid'};
 assert.deepEqual(schoolRoleAttendance(schools,'Bendahara',[record]),{arrivalTarget:1,recorded:1});
 assert.equal(schoolRoleAttendance(schools,'Bendahara',[{...record,npsn:'99999999'}]).recorded,0);
 assert.equal(schoolRoleAttendance(schools,'Bendahara',[{...record,name:'Different person'}]).recorded,0);
 assert.equal(schoolRoleAttendance(schools,'Bendahara',[{...record,position:'Kepala Sekolah'}]).recorded,0);
});

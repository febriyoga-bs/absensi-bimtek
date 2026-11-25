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

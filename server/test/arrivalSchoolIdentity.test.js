import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getSchoolArrivalStatuses} from '../src/arrivalRecap.js';
import {eventContext} from '../src/eventContext.js';
test('SDN and SD Negeri source rows stay separate when normalized names share a venue across NPSNs',async()=>{
 const schools=[{npsn:'10110573',name:'SDN ALUE LHOK',venue:'Novotel Mangga Dua',head_name:'Suharto'},
  {npsn:'10104468',name:'SD NEGERI ALUE LHOK',venue:'Novotel Mangga Dua',head_name:'Samsuar'}];
 const rows=[...['Ismualim','Martoti'].map(name=>({name,institution:schools[0].name,venue:schools[0].venue,position:'Bendahara',arrival_status:'selesai'})),
  ...['Samsuar','Syajaril'].map(name=>({name,institution:schools[1].name,venue:schools[1].venue,position:'Bendahara',arrival_status:'selesai'}))];
 const query=async sql=>({rows:sql.includes('arrival_corrections')?[{corrections:{}}]:rows});
 const result=await eventContext.run({id:5},()=>getSchoolArrivalStatuses(schools,null,query));
 assert.deepEqual(result[0].arrival_attendees.map(p=>p.name),['Ismualim','Martoti']);
 assert.deepEqual(result[1].arrival_attendees.map(p=>p.name),['Samsuar','Syajaril']);
 assert.equal(result[1].arrival_attendees[0].role,'Kepala Sekolah');
 const ambiguous=await eventContext.run({id:5},()=>getSchoolArrivalStatuses([schools[0],{...schools[0],npsn:'99999999'}],null,query));
 assert.ok(ambiguous.every(s=>s.arrival_attendees.length===0 && s.arrival_identity_ambiguous));
});

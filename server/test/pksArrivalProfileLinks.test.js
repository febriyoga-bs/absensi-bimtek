import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planArrivalProfileLinks} from '../src/pksArrivalProfileLinks.js';
import {arrivalPersonKey} from '../../shared/pksAttendeeName.js';
const profiles=[{id:1,name:'Sufyan, S.Pd',position:'Kepala Sekolah',npsn:'10101983',venue_id:1,venue:'Novotel Mangga Dua',has_attendance:false},
 {id:2,name:'Bendahara — SDN 1 Bintah',position:'Bendahara',npsn:'10101983',venue_id:1,venue:'Novotel Mangga Dua',has_attendance:false}];
const school={npsn:'10101983',name:'SDN 1 BINTAH',venue:'Novotel Mangga Dua',arrival_attendees:[
 {name:'Marzuki',role:'Perwakilan Sekolah',status:'selesai'}, {name:'Zakaria, S.Pd. M.Pd',role:'Perwakilan Sekolah',status:'sedang_antre'}]};
test('two representatives replace two unused slots and keep their generic role',()=>{
 const [patch]=planArrivalProfileLinks([school],profiles,[{venue_id:1,marks:{},representatives:{}}]);
 assert.equal(patch.representatives[1].name,'Marzuki');
 assert.equal(patch.representatives[2].role,'Perwakilan Sekolah');
 assert.deepEqual(patch.marks,{1:'selesai',2:'sedang_antre'});
 assert.equal(profiles[0].name,'Sufyan, S.Pd');
 const again=planArrivalProfileLinks([school],profiles.map(p=>({...p,has_attendance:true})),[patch]);
 assert.equal(again.length,0);
});
test('ambiguous same-name schools and excess attendees are not reassigned',()=>{
 assert.equal(planArrivalProfileLinks([school,{...school,npsn:'99999999'}],profiles,[{venue_id:1}]).length,0);
 assert.equal(planArrivalProfileLinks([{...school,arrival_attendees:[...school.arrival_attendees,{name:'Third'}]}],profiles,[{venue_id:1}]).length,0);
});
test('latest recap replaces recorded old identities within the same NPSN and venue',()=>{
 const source={npsn:'10107859',name:'SD NEGERI ARONGAN WOYLA',venue:'Lumire Jakarta',arrival_attendees:[
  {name:'Zainiyah',role:'Perwakilan Sekolah',status:'selesai'},
  {name:'Dosis',role:'Perwakilan Sekolah',status:'selesai'},
 ]};
 const people=profiles.map((p,index)=>({...p,npsn:source.npsn,venue:source.venue,has_attendance:true,
  name:index ? 'Bendahara - SD Negeri Arongan Woyla' : 'Adi Darmawan'}));
 const [patch]=planArrivalProfileLinks([source],people,[{venue_id:1,marks:{},representatives:{}}]);
 assert.deepEqual(Object.values(patch.representatives).map(p=>p.name).sort(),['Dosis','Zainiyah']);
 assert.ok(Object.values(patch.representatives).every(p=>p.role==='Perwakilan Sekolah' && p.npsn==='10107859'));
 assert.deepEqual(patch.marks,{1:'selesai',2:'selesai'});
 assert.equal(people[0].name,'Adi Darmawan');
 assert.equal(planArrivalProfileLinks([source],people,[patch]).length,0);
 assert.equal(planArrivalProfileLinks([source],people.map(p=>({...p,npsn:'99999999'})),[{venue_id:1}]).length,0);
});
test('degree punctuation matches Fidaini without changing the person identity',()=>{
 assert.equal(arrivalPersonKey('Fidaini S,pd'),arrivalPersonKey('fidaini spd'));
 assert.equal(arrivalPersonKey('Fidaini, S.Pd.'),arrivalPersonKey('Fidaini'));
 assert.notEqual(arrivalPersonKey('Fidaini'),arrivalPersonKey('Saidul Syahir Nuwi'));
});

test('Darul Aman links completed head and treasurer even when their slots already have attendance',()=>{
 const source={npsn:'10101796',name:'SDN 2 DARUL AMAN',venue:'Novotel Mangga Dua',arrival_attendees:[
  {name:'fidaini spd',role:'Kepala Sekolah',status:'selesai'},
  {name:'SAIDUL SYAHIR NUWI',role:'Bendahara',status:'selesai'},
 ]};
 const people=[
  {id:3,npsn:'10101796',name:'Fidaini S,pd',position:'Kepala Sekolah',venue_id:1,venue:source.venue,has_attendance:true},
  {id:4,npsn:'10101796',name:'Bendahara — SDN 2 Darul Aman',position:'Bendahara',venue_id:1,venue:source.venue,has_attendance:true},
 ];
 const [patch]=planArrivalProfileLinks([source],people,[{venue_id:1,marks:{},representatives:{}}]);
 assert.equal(patch.marks[3],'selesai');assert.equal(patch.marks[4],'selesai');
 assert.equal(patch.representatives[4].name,'SAIDUL SYAHIR NUWI');
 assert.equal(people[0].has_attendance,true);
});

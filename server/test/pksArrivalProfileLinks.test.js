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
test('same-name schools can link uniquely identified heads to their own NPSN only',()=>{
 const schools=[{npsn:'10101795',name:'SDN GAMPONG JALAN',venue:'Novotel Mangga Dua',head_name:'Khalijah Siregar',
  arrival_attendees:[{name:'Khalijah Siregar',role:'Kepala Sekolah',status:'selesai'}]},
 {npsn:'10102100',name:'SDN GAMPONG JALAN',venue:'Novotel Mangga Dua',head_name:'Suryani',
  arrival_attendees:[{name:'Suryani',role:'Kepala Sekolah',status:'selesai'}]}];
 const people=schools.flatMap((s,index)=>[
  {id:index*2+1,npsn:s.npsn,venue:s.venue,venue_id:1,name:s.head_name,position:'Kepala Sekolah',has_attendance:true},
  {id:index*2+2,npsn:s.npsn,venue:s.venue,venue_id:1,name:'Bendahara - SDN Gampong Jalan',position:'Bendahara',has_attendance:true}]);
 const [patch]=planArrivalProfileLinks(schools,people,[{venue_id:1,marks:{},representatives:{}}]);
 assert.deepEqual(patch.marks,{1:'selesai',3:'selesai'});
 assert.equal(patch.representatives[2],undefined);assert.equal(patch.representatives[4],undefined);
});
test('unknown uploaded names never replace recorded identities by school slot',()=>{
 const source={npsn:'10107859',name:'SD NEGERI ARONGAN WOYLA',venue:'Lumire Jakarta',arrival_attendees:[
  {name:'Zainiyah',role:'Perwakilan Sekolah',status:'selesai'},
  {name:'Dosis',role:'Perwakilan Sekolah',status:'selesai'},
 ]};
 const people=profiles.map((p,index)=>({...p,npsn:source.npsn,venue:source.venue,has_attendance:true,
  name:index ? 'Bendahara - SD Negeri Arongan Woyla' : 'Adi Darmawan'}));
 assert.equal(planArrivalProfileLinks([source],people,[{venue_id:1,marks:{},representatives:{}}]).length,0);
 assert.equal(people[0].name,'Adi Darmawan');
 assert.equal(planArrivalProfileLinks([source],people.map(p=>({...p,npsn:'99999999'})),[{venue_id:1}]).length,0);
});
test('degree punctuation matches Fidaini without changing the person identity',()=>{
 assert.equal(arrivalPersonKey('Fidaini S,pd'),arrivalPersonKey('fidaini spd'));
 assert.equal(arrivalPersonKey('Fidaini, S.Pd.'),arrivalPersonKey('Fidaini'));
 assert.notEqual(arrivalPersonKey('Fidaini'),arrivalPersonKey('Saidul Syahir Nuwi'));
});
test('stale representative bindings cannot relabel recorded profiles or copy a head onto two roles',()=>{
 const people=profiles.map(p=>({...p,has_attendance:true}));
 const recap={venue_id:1,marks:{},representatives:{1:{name:'Marzuki'},2:{name:'Zakaria, S.Pd. M.Pd'}}};
 assert.equal(planArrivalProfileLinks([school],people,[recap]).length,0);
 const duplicate={...school,arrival_attendees:[
  {name:'Sufyan',role:'Kepala Sekolah',status:'selesai'},
  {name:'Sufyan',role:'Bendahara',status:'selesai'}]};
 assert.equal(planArrivalProfileLinks([duplicate],people,[recap]).length,0);
});
test('confirmed Beutong head arrival is moved off the sick treasurer slot',()=>{
 const source={npsn:'10104774',name:'SD NEGERI 1 BEUTONG ATEUH',venue:'Lumire Jakarta',arrival_attendees:[
  {name:'Zainuddin, S.Pd.I',role:'Kepala Sekolah',status:'selesai'},
  {name:'Bendahara — SD NEGERI 1 BEUTONG ATEUH',role:'Bendahara',status:'belum_tiba'}]};
 const people=profiles.map((p,i)=>({...p,npsn:source.npsn,venue:source.venue,has_attendance:true,name:source.arrival_attendees[i].name}));
 const recap={venue_id:1,marks:{2:'selesai'},representatives:{2:{name:'Zainuddin, S.Pd.I',role:'Kepala Sekolah'}}};
 const [patch]=planArrivalProfileLinks([source],people,[recap]);
 assert.equal(patch.representatives[1].name,'Zainuddin, S.Pd.I');
 assert.equal(patch.representatives[1].role,'Kepala Sekolah');
 assert.equal(patch.representatives[2].role,'Bendahara');
 assert.deepEqual(patch.marks,{1:'selesai',2:'belum_tiba'});
});

test('Darul Aman restores the unique treasurer placeholder when the source head matches the same school',()=>{
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
test('Muhammadiyah restores Nur Jannah after reimport without replacing a named recorded treasurer',()=>{
 const source={npsn:'10105697',name:'SD 2 MUHAMMADIYAH',venue:'Lumire Jakarta',arrival_attendees:[
  {name:'Dr. Hamdani, MA',role:'Kepala Sekolah',status:'selesai'},
  {name:'Nur Jannah',role:'Bendahara',status:'selesai'}]};
 const people=[{id:5,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Dr. Hamdani, Ma',position:'Kepala Sekolah',has_attendance:true},
  {id:6,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Bendahara — SD 2 Muhammadiyah',position:'Bendahara',has_attendance:true}];
 const [patch]=planArrivalProfileLinks([source],people,[{venue_id:1,representatives:{},marks:{}}]);
 assert.equal(patch.representatives[6].name,'Nur Jannah');
 assert.equal(patch.representatives[6].role,'Bendahara');assert.equal(patch.marks[6],'selesai');
 const named=people.map(p=>p.id===6?{...p,name:'Other recorded person'}:p);
 assert.equal(planArrivalProfileLinks([source],named,[{venue_id:1}])[0].representatives[6],undefined);
 const unknown={...source,arrival_attendees:source.arrival_attendees.map(p=>({...p,role:'Perwakilan Sekolah'}))};
 assert.equal(planArrivalProfileLinks([unknown],people,[{venue_id:1}])[0]?.representatives[6],undefined);
});


test('Ladang Rimba restores both placeholders using the confirmed mapping head, preserving each source status',()=>{
 const source={npsn:'10102822',name:'SD NEGERI 2 LADANG RIMBA',venue:'Lumire Jakarta',head_name:'Putro Cut',arrival_attendees:[
  {name:'EDI SAPUTRA,S.Pd',role:'Bendahara',status:'selesai'},
  {name:'PUTRO CUT,S.Pd',role:'Kepala Sekolah',status:'sedang_antre'}]};
 const people=[{id:7,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Kepala Sekolah — SD Negeri 2 Ladang Rimba',position:'Kepala Sekolah',has_attendance:true},
  {id:8,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Bendahara — SD Negeri 2 Ladang Rimba',position:'Bendahara',has_attendance:true}];
 const [patch]=planArrivalProfileLinks([source],people,[{venue_id:1,marks:{},representatives:{}}]);
 assert.equal(patch.representatives[7].name,'PUTRO CUT,S.Pd');
 assert.equal(patch.representatives[8].name,'EDI SAPUTRA,S.Pd');
 assert.deepEqual(patch.marks,{7:'sedang_antre',8:'selesai'});
 assert.equal(people[0].name,'Kepala Sekolah — SD Negeri 2 Ladang Rimba');
 const unknown={...source,head_name:undefined};
 assert.equal(planArrivalProfileLinks([unknown],people,[{venue_id:1}]).length,0);
 const named=people.map(p=>p.id===7?{...p,name:'Different recorded head'}:p);
 assert.equal(planArrivalProfileLinks([source],named,[{venue_id:1}])[0]?.representatives[7],undefined);
});


test('Labuhan Haji restores a documented previous head only when no attendance is attached',()=>{
 const source={npsn:'10102835',name:'SD NEGERI 3 LABUHAN HAJI',venue:'Lumire Jakarta',head_name:'Tarna Yultri',arrival_attendees:[
 {name:'Tarnayultri',role:'Kepala Sekolah',status:'selesai'},
 {name:'Meri safrida',role:'Bendahara',status:'selesai'}]};
 const people=[{id:9,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Asmina',position:'Kepala Sekolah',has_attendance:false},
 {id:10,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Bendahara — SD Negeri 3 Labuhan Haji',position:'Bendahara',has_attendance:false}];
 const [patch]=planArrivalProfileLinks([source],people,[{venue_id:1}]);
 assert.equal(patch.representatives[9].name,'Tarnayultri');
 assert.equal(patch.representatives[10].name,'Meri safrida');
 assert.deepEqual(patch.marks,{9:'selesai',10:'selesai'});
 assert.equal(planArrivalProfileLinks([source],people.map(p=>({...p,has_attendance:true})),[{venue_id:1}])[0]?.representatives[9],undefined);
 assert.equal(planArrivalProfileLinks([source],people.map(p=>p.id===9?{...p,name:'Other person'}:p),[{venue_id:1}])[0]?.representatives[9],undefined);
});


test('Baktiya links two arrived representatives while retaining the absent head source record',()=>{
 const source={npsn:'10101717',name:'SD NEGERI 17 BAKTIYA',venue:'Novotel Mangga Dua',head_name:'Musliadi',arrival_attendees:[
 {name:'Hamdan Nasri S.Pd',role:'Perwakilan Sekolah',status:'selesai'},
 {name:'Iskandar,S.Pd',role:'Perwakilan Sekolah',status:'selesai'},
 {name:'Musliadi',role:'Kepala Sekolah',status:'belum_tiba'}]};
 const people=[{id:11,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Musliadi',position:'Kepala Sekolah',has_attendance:false},
 {id:12,npsn:source.npsn,venue:source.venue,venue_id:1,name:'Bendahara — SD Negeri 17 Baktiya',position:'Bendahara',has_attendance:false}];
 const [patch]=planArrivalProfileLinks([source],people,[{venue_id:1}]);
 assert.equal(Object.keys(patch.representatives).length,2);
 assert.ok(Object.values(patch.representatives).every(p=>p.role==='Perwakilan Sekolah'));
 assert.deepEqual(patch.marks,{11:'selesai',12:'selesai'});
 assert.equal(source.arrival_attendees.length,3);
 assert.equal(source.arrival_attendees[2].name,'Musliadi');
 assert.equal(planArrivalProfileLinks([source],people.map(p=>({...p,has_attendance:true})),[{venue_id:1}]).length,0);
});


test('Alue Lhok directory honors exact-source resolution from the same PKS resolver',()=>{
 const schools=[{npsn:'10104468',name:'SD NEGERI ALUE LHOK',venue:'Novotel Mangga Dua',head_name:'Samsuar',arrival_identity_ambiguous:false,
 arrival_attendees:[{name:'Samsuar',role:'Kepala Sekolah',status:'selesai'},{name:'Syajaril Akhzari',role:'Bendahara',status:'selesai'}]},
 {npsn:'10110573',name:'SDN ALUE LHOK',venue:'Novotel Mangga Dua',head_name:'Suharto',arrival_identity_ambiguous:false,
 arrival_attendees:[{name:'Ismualim,S.Pd.I',role:'Perwakilan Sekolah',status:'selesai'},{name:'Martoti',role:'Perwakilan Sekolah',status:'selesai'}]}];
 const people=schools.flatMap((s,i)=>[{id:i*2+21,npsn:s.npsn,venue:s.venue,venue_id:1,name:s.head_name,position:'Kepala Sekolah',has_attendance:false},
 {id:i*2+22,npsn:s.npsn,venue:s.venue,venue_id:1,name:i?'Bendahara — SDN Alue Lhok':'Syajaril Akhzari',position:'Bendahara',has_attendance:false}]);
 const [patch]=planArrivalProfileLinks(schools,people,[{venue_id:1}]);
 assert.deepEqual(patch.marks,{21:'selesai',22:'selesai',23:'selesai',24:'selesai'});
 assert.equal(patch.representatives[22].name,'Syajaril Akhzari');
 assert.equal(patch.representatives[23].name,'Ismualim,S.Pd.I');
 assert.equal(patch.representatives[24].name,'Martoti');
 assert.equal(patch.representatives[24].role,'Perwakilan Sekolah');
 assert.equal(people[2].name,'Suharto');
});

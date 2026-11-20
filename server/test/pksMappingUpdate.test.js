import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPksMappingUpdate, normalizeHeadPhone } from '../src/pksMappingUpdate.js';

function fixture() {
  const oldSchool = { npsn: '12345678', name:'SDN Contoh',venue:'Hotel',lo:'LO Satu',facilitator:'Verifikator Lama' };
  const school = { ...oldSchool, facilitator:'Verifikator Baru', coordinator:'Koordinator',head_name:'Kepala Baru',head_phone:'. O81234567890' };
  const source = {kind:'pks_spab',stage:5,venues:['Hotel'],lo:[{name:'LO Satu',venue:'Hotel'}], schools:[school],
    verifier_people:[{name:'Verifikator Lama',venue:'Hotel',coordinator:'Koordinator'},{name:'Verifikator Baru',venue:'Hotel',coordinator:'Koordinator'}],
    coordinators:[{name:'Koordinator',venue:'Hotel'}]};
  const current = {roster:{schools:[oldSchool],lo:[{name:'LO Satu',venue:'Hotel',account_id:9,venue_id:1}],facilitators:[{name:'Verifikator Lama',venue:'Hotel',code:'old-v'}],pks_records:{'12345678':{status:'lengkap',nomor_pks:'existing'}}},
    accounts:[{id:9,name:'LO Satu',username:'SPAB.LO.Satu',password_hash:'keep',venue_id:1}],venues:[{id:1,name:'Hotel'}],people:[
      {id:1,code:'keep-k',name:'Kepala Sekolah — SDN Contoh',position:'Kepala Sekolah',role:'peserta',npsn:'12345678',venue_id:1},
      {id:2,code:'keep-b',name:'Bendahara Aktual',phone:'0811111111',position:'Bendahara',role:'peserta',npsn:'12345678',venue_id:1},
      {id:3,code:'old-v',name:'Verifikator Lama',position:'Verifikator',role:'peserta',venue_id:1},
      {id:4,code:'SPAB.LO.Satu',name:'LO Satu',position:'LO',role:'panitia',venue_id:1},
    ]};
  return {source,current};
}
test('mapping update fills school identity, preserves stable codes and PKS status, and rebuilds LO assignments', () => {
  const {source,current} = fixture();
  const plan = planPksMappingUpdate(source,current);
  assert.equal(plan.updates.find(row=>row.id===1).name,'Kepala Baru');
  assert.equal(plan.updates.find(row=>row.id===1).phone,'081234567890');
  assert.equal(plan.updates.find(row=>row.id===2).name,'Bendahara Aktual');
  assert.equal(plan.updates.find(row=>row.id===2).phone,'0811111111');
  assert.ok(!plan.updates.some(row=>row.id===4));
  assert.equal(plan.inserts.length,1);
  assert.deepEqual(plan.roster.pks_records,current.roster.pks_records);
  assert.equal(plan.roster.participants[0].code,'keep-k');
  assert.equal(plan.roster.facilitators[0].name,'Verifikator Baru');
  assert.deepEqual(plan.roster.attendance_assignments[9].map(row=>row.name),['Kepala Baru','Bendahara Aktual','Verifikator Baru']);
  assert.equal(plan.roster.lo[0].account_id,9);
});
test('missing school source values retain existing names and contact details', () => {
  const {source,current} = fixture();
  source.schools[0].head_name='';source.schools[0].head_phone='';current.people[0].phone='08123456789';
  const plan=planPksMappingUpdate(source,current);
  assert.equal(plan.updates.find(row=>row.id===1).name,current.people[0].name);
  assert.equal(plan.updates.find(row=>row.id===1).phone,'08123456789');
});
test('ambiguous profiles and inconsistent coordinator mappings stop the update', () => {
  let {source,current} = fixture();current.people.push({...current.people[0],id:5});
  assert.throws(()=>planPksMappingUpdate(source,current),/Profil Kepala Sekolah/);
  ({source,current}=fixture());source.schools[0].coordinator='Lain';
  assert.throws(()=>planPksMappingUpdate(source,current),/tidak konsisten/);
  ({source,current}=fixture());source.schools[0].npsn='87654321';
  assert.throws(()=>planPksMappingUpdate(source,current),/NPSN/);
});
test('phone normalization preserves leading zero and rejects non-contact text', () => {
  assert.equal(normalizeHeadPhone('+62 812-3456-7890'),'+6281234567890');
  assert.equal(normalizeHeadPhone('0812 3456 7890'),'081234567890');
  assert.equal(normalizeHeadPhone(''),null);
  assert.throws(()=>normalizeHeadPhone('belum ada'),/karakter/);
});

import {arrivalPersonKey} from '../../shared/pksAttendeeName.js';
export function schoolRoleDetails(schools, role, records) {
  const targets=new Map();
  for(const school of schools) {
    const people=(school.arrival_attendees || []).filter(p=>p.role===role && ['selesai','sudah_tiba','sedang_antre'].includes(p.status));
    if(people.length)targets.set(String(school.npsn),{school,people});
  }
  return [...targets].map(([npsn,{school,people}])=>{
    const matches=records.filter(record=>String(record.npsn || '').split(';').map(s=>s.trim()).includes(npsn)
      && ['valid','review','ditolak','berhalangan'].includes(record.status)
      && people.some(p=>[record.name,record.original_name].some(name=>arrivalPersonKey(name)===arrivalPersonKey(p.name))));
    const priority={valid:0,review:1,ditolak:2,berhalangan:3};
    matches.sort((a,b)=>priority[a.status]-priority[b.status]);
    const record=matches[0];
    const person=people.find(p=>record && [record.name,record.original_name].some(name=>arrivalPersonKey(name)===arrivalPersonKey(p.name))) || people[0];
    return {npsn,name:person.name,institution:school.name,source_person_id:record?.person_id,people:[{name:person.name,position:role,
      arrival_status:person.status,registered:!!record,status:record?.status || null}]};
  });
}
export function schoolRoleAttendance(schools, role, records) {
  const entries=schoolRoleDetails(schools,role,records);
  return {arrivalTarget:entries.length,recorded:entries.filter(e=>e.people[0].status).length};
}

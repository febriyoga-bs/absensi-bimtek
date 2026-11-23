import { mappingNameKey, normalizeHeadPhone } from './pksMappingUpdate.js';

export function planPksContacts(source, roster, people, venues) {
  const issues = [], changes = [];
  const copy = structuredClone(roster);
  const schoolSources = new Map(), contacts = new Map();
  const identity = (venue,name) => JSON.stringify([venue,mappingNameKey(name)]);
  const put = (map,key,field,value) => {
    if (!value) return;
    if (!map.has(key)) map.set(key,{});
    const row=map.get(key); (row[field] ||= new Set()).add(value);
  };
  for (const row of source) {
    const rawNpsn=String(row.A || '').trim();
    const numericNpsn=/^\d+(?:\.\d+)?(?:e\+?\d+)?$/i.test(rawNpsn) ? Number(rawNpsn) : NaN;
    const npsn=Number.isSafeInteger(numericNpsn) && numericNpsn>0 ? String(numericNpsn).padStart(8,'0') : '';
    if (!/^\d{8}$/.test(npsn)) continue;
    const phone = (value) => {
      try { return normalizeHeadPhone(value); }
      catch { issues.push({npsn,reason:'Nomor sumber tidak valid'}); return null; }
    };
    put(schoolSources,npsn,'head_phone',phone(row.I));
    put(schoolSources,npsn,'head_name',row.H?.trim());
    for (const [name,tel,email] of [[row.L,row.N,row.O],[row.P,row.R,row.S]]) {
      if (!name) continue;
      const key=identity(row.E,name);
      put(contacts,key,'phone',phone(tel));
      if (email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) put(contacts,key,'email',email.trim().toLowerCase());
    }
  }
  const unique = (map,key,field) => {
    const values=map.get(key)?.[field];
    if (values?.size>1) { issues.push({key,field,reason:'Kontak sumber berbeda untuk identitas yang sama'}); return null; }
    return values?.values().next().value;
  };
  const fill = (row,field,value,type) => {
    if (!value || String(row[field] || '').trim()) return;
    row[field]=value; changes.push({type,field});
  };
  for (const school of copy.schools || []) {
    fill(school,'head_phone',unique(schoolSources,school.npsn,'head_phone'),'school');
    for (const [name,prefix] of [[school.facilitator,'facilitator'],[school.coordinator,'coordinator']]) {
      for (const field of ['phone','email']) fill(school,`${prefix}_${field}`,unique(contacts,identity(school.venue,name),field),'school');
    }
  }
  for (const list of ['coordinators','verifier_people','facilitators']) for (const row of copy[list] || []) {
    for (const field of ['phone','email']) fill(row,field,unique(contacts,identity(row.venue,row.name),field),list);
    if (row.coordinator) for (const field of ['phone','email']) fill(row,`coordinator_${field}`,unique(contacts,identity(row.venue,row.coordinator),field),list);
  }
  const venueNames=new Map(venues.map(row=>[row.id,row.name]));
  const updates=[];
  for (const person of people) {
    if (person.archived_at || person.phone) continue;
    let phone;
    if (mappingNameKey(person.position)==='kepalasekolah') {
      const ids=String(person.npsn || '').split(';').map(v=>v.trim()).filter(Boolean);
      if (ids.length!==1) continue;
      const name=unique(schoolSources,ids[0],'head_name');
      if (name && mappingNameKey(name)===mappingNameKey(person.name)) phone=unique(schoolSources,ids[0],'head_phone');
    } else if (['verifikator','koordinator'].includes(mappingNameKey(person.position))) {
      phone=unique(contacts,identity(venueNames.get(person.venue_id),person.name),'phone');
    }
    if (phone) updates.push({id:person.id,phone});
  }
  // Participant snapshots are also read by some views.
  const byCode=new Map(people.map(p=>[p.code,p]));
  const byId=new Map(updates.map(p=>[p.id,p.phone]));
  for (const row of copy.participants || []) fill(row,'phone',byId.get(byCode.get(row.code)?.id),'participants');
  return {roster:copy,updates,summary:{fields_added:changes.length,profiles_updated:updates.length,
    by_type:changes.reduce((out,row)=>(out[row.type]=(out[row.type]||0)+1,out),{}),issues:[...new Map(issues.map(row=>[JSON.stringify(row),row])).values()]}};
}

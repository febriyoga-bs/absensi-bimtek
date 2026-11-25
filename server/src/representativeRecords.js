const nameKey=value=>String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

// Build once per venue/request; never scan and normalize all entries per record.
export function representativeMatcher(entries) {
  const byName=new Map();
  for(const entry of entries) {
    const key=nameKey(entry.name);
    if(!key)continue;
    if(!byName.has(key))byName.set(key,[]);
    byName.get(key).push(entry);
  }
  return record=>{
    const candidates=new Set();
    const npsns=record.npsn ? String(record.npsn).split(';') : null;
    for(const key of new Set([nameKey(record.name),nameKey(record.original_name)])) {
      for(const entry of byName.get(key) || []) {
        if(!npsns || npsns.includes(entry.npsn))candidates.add(entry);
      }
    }
    return candidates.size===1 ? candidates.values().next().value : null;
  };
}

export function representativeAttendance(entries,records) {
  const match=representativeMatcher(entries),byEntry=new Map();
  for(const record of records) {
    const entry=match(record);
    if(!entry)continue;
    if(!byEntry.has(entry))byEntry.set(entry,[]);
    byEntry.get(entry).push(record);
  }
  return entries.map(entry=>{
    const matches=byEntry.get(entry) || [];
    const record=matches.length===1 ? matches[0] : null;
    return {...entry,people:entry.people.map(person=>({...person,registered:!!record,status:record?.status || null}))};
  });
}

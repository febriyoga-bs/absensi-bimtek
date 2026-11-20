export function attendancePdfGroups(records) {
  const groups = [
    { key:'hadir', label:'Hadir', rows:[] },
    { key:'berhalangan', label:'Berhalangan Hadir', rows:[] },
    { key:'lainnya', label:'Ditolak / Status Lain', rows:[] },
  ];
  for (const row of records) groups[row.status === 'berhalangan' ? 1 : ['valid','review'].includes(row.status) ? 0 : 2].rows.push(row);
  return groups;
}

export function attendancePdfCategorySummary(records) {
  const categories = [
    ['bendahara','Bendahara (Sekolah)'], ['pengawas','Pengawas'],
    ['fasil','Fasilitator'], ['dinas','Dinas Pendidikan'], ['bpmp','BB/BPMP'],
    ['lo','LO'], ['lainnya','Lainnya'],
  ];
  const category = row => {
    const p = String(row.position || '').trim().toLowerCase();
    if (/^fasil/.test(p)) return 'fasil';
    if (p === 'bendahara' || p === 'sekolah') return 'bendahara';
    if (p === 'pengawas') return 'pengawas';
    if (p === 'dinas pendidikan') return 'dinas';
    if (['bb/bpmp','bpmp','bbpmp'].includes(p)) return 'bpmp';
    if (/^lo($|\s)|^liaison officer$/.test(p)) return 'lo';
    return 'lainnya';
  };
  const unique = rows => new Set(rows.map(row => row.person_id ?? row.code ?? row.id)).size;
  return categories.map(([key,label])=>{
    const rows = records.filter(row=>category(row)===key);
    const groups = attendancePdfGroups(rows);
    return {key,label,total:unique(rows),hadir:unique(groups[0].rows),berhalangan:unique(groups[1].rows),lainnya:unique(groups[2].rows)};
  }).filter(row=>!['lo','lainnya'].includes(row.key)||row.total>0);
}

export function attendancePdfSections(records) {
  const isLo = row => /^lo($|\s)|^liaison officer$/i.test(String(row.position || '').trim());
  return [true, false].flatMap(lo => attendancePdfGroups(records.filter(row => isLo(row) === lo))
    .filter(group => group.rows.length)
    .map(group => ({...group,label:`${lo ? 'LO' : 'Peserta / Panitia'} - ${group.label}`})));
}

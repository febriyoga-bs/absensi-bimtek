import { eventLabel, selectedEvent } from '../event.js';
import { personName } from './personName.js';

export const attendancePdfName = row => personName(row.representative?.name || row.name);
export const attendancePdfPosition = row => eventLabel(row.representative?.role || row.position || '-');

export function attendancePdfCategory(row) {
  const position = attendancePdfPosition(row).trim().toLowerCase();
  if (/^lo($|\s)|^liaison officer$/.test(position)) return 'lo';
  if (/^(verifikator|fasil)/.test(position)) return 'verifikator';
  if (position === 'perwakilan sekolah') return 'perwakilan';
  if (position === 'kepala sekolah') return 'kepsek';
  if (position === 'bendahara' || position === 'sekolah') return 'bendahara';
  if (position === 'pengawas') return 'pengawas';
  if (['dinas','dinas pendidikan'].includes(position)) return 'dinas';
  if (['bpmp','bb/bpmp','bbpmp'].includes(position)) return 'bpmp';
  return 'lainnya';
}

export function attendancePdfGroups(records) {
  const groups = [
    { key:'hadir', label:'Hadir', rows:[] },
    { key:'berhalangan', label:'Berhalangan Hadir', rows:[] },
    { key:'lainnya', label:'Absen Ditolak', rows:[] },
  ];
  for (const row of records) groups[row.status === 'berhalangan' ? 1 : ['valid','review'].includes(row.status) ? 0 : 2].rows.push(row);
  return groups;
}

export function attendancePdfCategorySummary(records) {
  const categories = [...(selectedEvent()?.id === 5 ? [
    ['kepsek','Kepala Sekolah'], ['bendahara','Bendahara'],
    ['perwakilan','Perwakilan Sekolah'], ['verifikator','Verifikator'], ['lo','LO'],
  ] : [
    ['bendahara','Bendahara'], ['pengawas','Pengawas'], ['dinas','Dinas'],
    ['bpmp','BPMP'], ['verifikator','Fasilitator'], ['lo','LO'],
  ]),
    ['lainnya','Lainnya'],
  ];
  const unique = rows => new Set(rows.map(row => row.person_id ?? row.code ?? row.id)).size;
  return categories.map(([key,label])=>{
    const rows = records.filter(row=>attendancePdfCategory(row)===key);
    const groups = attendancePdfGroups(rows);
    return {key,label,total:unique(rows),hadir:unique(groups[0].rows),berhalangan:unique(groups[1].rows),lainnya:unique(groups[2].rows)};
  }).filter(row=>row.key!=='lainnya'||row.total>0);
}

export function attendancePdfSections(records) {
  const collator = new Intl.Collator('id-ID', { sensitivity:'base', numeric:true });
  const section = row => {
    const category = attendancePdfCategory(row);
    return ['lo','verifikator'].includes(category) ? category : 'peserta';
  };
  return [['lo','LO'],['verifikator',selectedEvent()?.id === 5 ? 'Verifikator' : 'Fasilitator'],['peserta','Peserta']].flatMap(([key,label]) => attendancePdfGroups(records.filter(row => section(row) === key))
    .filter(group => group.rows.length)
    .map(group => ({...group,label:`${label} - ${group.label}`,rows:[...group.rows].sort((a,b) =>
      (key === 'peserta' ? collator.compare(a.institution || '', b.institution || '') || collator.compare(a.npsn || '', b.npsn || '') : 0)
      || collator.compare(attendancePdfName(a),attendancePdfName(b)) || Number(a.id)-Number(b.id))})));
}

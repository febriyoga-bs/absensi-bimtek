import {documentStatuses,documentsComplete,rabStatuses} from '../../../shared/pksBimtek.js';
const pksStatuses={belum_diterima:'Belum diterima',menunggu_verifikasi:'Menunggu verifikasi',perlu_perbaikan:'Perlu perbaikan',lengkap:'Lengkap'};
export function schoolInspectionItems(school) {
  const record=school.bimtek, rab=record?.rab_status;
  const correction=record?.document_status==='perlu_perbaikan' || rab==='perlu_perbaikan' || school.pks?.status==='perlu_perbaikan';
  const recorded=record != null || !!school.pks?.updated_at;
  return [
    {metric:'documents',label:'Dokumen',status:documentStatuses[record?.document_status] || (documentsComplete(record)?'Lengkap':'Belum dicatat')},
    {metric:'submitted',label:'Pengajuan RAB',status:rabStatuses[rab] || 'Belum dicatat'},
    {metric:'reviewed',label:'Hasil reviu RAB',status:rab==='sesuai'?'Sesuai hasil reviu':rab==='perlu_perbaikan'?'Perlu perbaikan':rab && rab!=='belum_diajukan'?'Menunggu hasil reviu':'Belum dicatat'},
    {metric:'followup',label:'Tindak lanjut',status:correction?'Perlu perbaikan':recorded?'Tidak ada perbaikan tercatat':'Belum dicatat'},
    {metric:'complete',label:'PKS',status:pksStatuses[school.pks?.status] || 'Belum dicatat'},
  ];
}

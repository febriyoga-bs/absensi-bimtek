export const assistanceTypes = {
  rkd: 'Ruang Kelas Darurat', school_kit: 'School Kit', meubelair: 'Meubelair',
  komputer: 'Lab Komputer', olahraga: 'Alat Olahraga', operasional: 'Bantuan Operasional',
};
export const rabStatuses = { belum_diajukan: 'Belum diajukan', diajukan: 'Menunggu reviu', perlu_perbaikan: 'Perlu perbaikan', diajukan_ulang: 'Perbaikan diajukan kembali', sesuai: 'Sesuai hasil reviu' };
export const documentLabels = { data_sekolah: 'Data sekolah / Dapodik siap', sk_tim: 'SK Tim Pelaksana', izin_operasional: 'Izin operasional sekolah swasta', kesiapan: 'Surat kesiapan lahan / ruang' };
export const documentStatuses = { belum_dicatat: 'Belum dicatat', belum_lengkap: 'Belum lengkap', menunggu_verifikasi: 'Menunggu verifikasi', perlu_perbaikan: 'Perlu perbaikan', lengkap: 'Lengkap' };
export function requiredDocuments(record = {}) {
  record = record ?? {};
  return ['data_sekolah','sk_tim', ...(record.school_type === 'swasta' ? ['izin_operasional'] : []),
    ...((record.assistance_types || []).some(type => ['rkd','komputer'].includes(type)) ? ['kesiapan'] : [])];
}
export function documentsComplete(record = {}) {
  if (record == null) return false;
  if (record.document_status != null) return record.document_status === 'lengkap';
  return ['negeri','swasta'].includes(record.school_type) && record.assistance_types?.length > 0
    && requiredDocuments(record).every(key => record.documents?.[key] === true);
}
export function summarizeBimtek(schools = []) {
  return Object.fromEntries(['total','documents','submitted','reviewed','followup','complete'].map(key=>[key,schoolsForBimtekMetric(schools,key).length]));
}
export function schoolsForBimtekMetric(schools = [], metric) {
  const unique=[...new Map(schools.map(s=>[s.npsn,s])).values()];
  const matches={total:()=>true,documents:s=>documentsComplete(s.bimtek),
    submitted:s=>['diajukan','perlu_perbaikan','diajukan_ulang','sesuai'].includes(s.bimtek?.rab_status),
    reviewed:s=>s.bimtek?.rab_status==='sesuai',
    followup:s=>s.bimtek?.document_status==='perlu_perbaikan' || s.bimtek?.rab_status==='perlu_perbaikan' || s.pks?.status==='perlu_perbaikan',
    complete:s=>s.pks?.status==='lengkap'};
  return unique.filter(matches[metric] || (()=>false));
}

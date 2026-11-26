export const progressGroups = [
  { label: 'Biodata', className: 'pks-progress-group--bio', metrics: ['login', 'bio_isi', 'bio_kirim', 'bio_ok'] },
  { label: 'RAB & BA', className: 'pks-progress-group--rab', metrics: ['rab_kirim', 'sepakat_rab', 'ba'] },
  { label: 'PKS', className: 'pks-progress-group--pks', metrics: ['pks', 'pks_ppk', 'meterai'] },
];
export const progressStages = progressGroups.flatMap(group => group.metrics);
export const progressLabels = [
  ['total', 'Total sekolah'], ['login', 'Sudah login'], ['bio_isi', 'Sudah mengisi biodata'],
  ['bio_kirim', 'Sudah kirim biodata'], ['bio_ok', 'Sudah verifikasi biodata'],
  ['rab_kirim', 'Kirim proposal RAB'], ['sepakat_rab', 'Sepakat RAB'], ['ba', 'TTD BA'], ['pks', 'TTE Kepsek PKS'],
  ['pks_ppk', 'TTE PPK PKS'], ['meterai', 'E-Meterai'], ['tidak_terdata', 'Tidak terdata'],
];
export const progressMetricLabels = progressLabels.map(([key, label]) => [key,
  progressStages.includes(key) ? `${progressStages.indexOf(key) + 1}. ${label}` : label]);
export function progressStage(status) {
  const value = String(status || '').toLocaleLowerCase('id');
  if (value.includes('tidak terdata')) return 'tidak_terdata';
  const later = [['meterai', /e[- ]?meterai/], ['pks_ppk', /tte ppk pks/], ['pks', /tte kepsek pks/],
    ['ba', /ttd ba|tanda tangan ba/], ['sepakat_rab', /sepakat rab/], ['rab_kirim', /kirim proposal rab/], ['bio_ok', /sudah verifikasi biodata/],
    ['bio_kirim', /sudah kirim biodata|menunggu verifikasi biodata/],
    ['bio_isi', /sudah mengisi biodata|proses mengisi biodata/], ['login', /sudah login|belum mengisi biodata/]];
  return later.find(([, pattern]) => pattern.test(value))?.[0] || (value.includes('belum login') ? 'belum_login' : null);
}
export function hasProgressStage(stage, metric) {
  if (metric === 'total') return true;
  if (stage && typeof stage === 'object') {
    if (metric === 'tidak_terdata') return stage.stage === metric;
    if (Array.isArray(stage.achieved)) return stage.achieved.includes(metric);
    stage = stage.stage;
  }
  if (metric === 'tidak_terdata') return stage === metric;
  const target = progressStages.indexOf(metric);
  return target >= 0 && progressStages.indexOf(stage) >= target;
}
export function progressScore(stage) {
  if (stage && typeof stage === 'object') {
    if (stage.stage === 'tidak_terdata') return null;
    if (!stage.stage && !stage.achieved?.length) return null;
    if (Array.isArray(stage.achieved)) return new Set(stage.achieved.filter(key => progressStages.includes(key))).size * 100 / progressStages.length;
    stage = stage.stage;
  }
  if (stage === 'belum_login') return 0;
  const index = progressStages.indexOf(stage);
  return index < 0 ? null : (index + 1) * 100 / progressStages.length;
}

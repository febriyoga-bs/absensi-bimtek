export const periodReportLabels = { no_data: 'Belum ada data', not_filled: 'Belum diisi', filled: 'Sudah diisi',
  complete: 'Lengkap', reviewed: 'Sudah direviu', reviewed_complete: 'Lengkap · Sudah direviu' };
export default function PeriodReportStatus({ status }) {
  const style = ['reviewed','reviewed_complete'].includes(status) ? 'tag--open'
    : ['filled','complete'].includes(status) ? 'tag--venue' : 'tag--off';
  return <span className={`tag ${style}`}>{periodReportLabels[status] || periodReportLabels.no_data}</span>;
}

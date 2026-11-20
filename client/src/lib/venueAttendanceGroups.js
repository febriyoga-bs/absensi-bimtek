import { eventLabel } from '../event.js';
const groups = [
  ['bendahara', 'Bendahara (Sekolah)'], ['pengawas', 'Pengawas'],
  ['dinas', 'Dinas Pendidikan'], ['bpmp', 'BB/BPMP'],
  ['fasil', 'Fasilitator'], ['lo', 'LO'],
];

export const venueAttendanceGroups = groups.map(([id, label]) => {
  const row = [id, label];
  Object.defineProperty(row, '1', { get: () => eventLabel(label), enumerable: true });
  return row;
});

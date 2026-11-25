import { selectedEvent } from '../../event.js';
export const fmtDT = (d) =>
  new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

export const checkInDayLabel = (day) => `${day.label} · ${day.shortDate} ${day.date.slice(0, 4)}`;

export function sessionTitle(session) {
  if (selectedEvent()?.id === 5 && session?.name) return session.name;
  if (session?.check_in_day) return checkInDayLabel(session.check_in_day);
  return session?.name || session?.type || '—';
}

export function arrivalBadge(status) {
  if (status === 'sedang_antre') return ['Sedang antre', 'tag--venue'];
  if (status === 'selesai' || status === 'sudah_tiba') return ['Sudah tiba', 'tag--arrival'];
  if (status === 'belum_tiba') return ['Belum tiba', 'tag--off'];
  return ['Belum terdata', 'tag--off'];
}

const pksArrivalBadges = {
  'Belum terdata': ['Belum Konfirmasi', 'tag--venue'],
  'Belum tiba': ['Bersedia Hadir', 'tag--arrival-confirmed'],
  'Sudah tiba': ['Sudah Tiba (Terdata di SPJ)', 'tag--arrival'],
};

export function pksArrivalBadge(status) {
  const badge = arrivalBadge(status);
  return pksArrivalBadges[badge[0]] ?? badge;
}

export const FLAG_LABEL = {
  qr_lo: 'Diabsenkan LO / panitia',
  akurasi_rendah: 'Akurasi GPS rendah — cek manual',
  luar_radius_akurasi: 'Di tepi/luar radius, akurasi rendah — cek manual',
  koordinat_statis: 'Koordinat statis (indikasi Fake GPS)',
  presisi_rendah: 'Koordinat diketik manual',
  lompatan_lokasi: 'Lokasi melompat',
  kecepatan_tidak_wajar: 'Kecepatan tidak wajar',
  teleport: 'Teleport dari absen sebelumnya',
  perangkat_dipakai_orang_lain: 'HP dipakai orang lain (titip absen)',
  kamera_virtual: 'Kamera virtual',
  otomasi_browser: 'Browser otomatis',
  altitude_kosong: 'Tanpa data ketinggian',
  timestamp_tidak_wajar: 'Timestamp GPS janggal',
  jam_perangkat_beda: 'Jam HP tidak sinkron',
  sampel_sedikit: 'Sampel GPS sedikit',
};

export function attendanceReasonText(reasons) {
  if (!Array.isArray(reasons)) return '';
  return reasons.map((reason) => {
    if (typeof reason === 'string') return FLAG_LABEL[reason] || reason;
    if (!reason || typeof reason !== 'object') return '';
    const code = typeof reason.code === 'string' ? reason.code : '';
    const detail = typeof reason.detail === 'string' ? reason.detail.trim() : '';
    return [FLAG_LABEL[code] || code, detail].filter(Boolean).join(': ');
  }).filter(Boolean).join(' · ');
}

/** Date → nilai input datetime-local (waktu lokal browser) */
export const toLocalInput = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};

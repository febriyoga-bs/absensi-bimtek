export const fmtDT = (d) =>
  new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

export const FLAG_LABEL = {
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

/** Date → nilai input datetime-local (waktu lokal browser) */
export const toLocalInput = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};

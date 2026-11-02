import { haversine, median } from './util.js';

/**
 * Analisis lokasi untuk mendeteksi fake GPS / mock location.
 *
 * Browser tidak bisa membaca langsung apakah aplikasi Fake GPS aktif,
 * jadi kita menilai "sidik jari" data lokasi yang dikirim. Sinyal GPS asli
 * selalu sedikit bergoyang (jitter), punya presisi tinggi, timestamp segar,
 * dan tidak melompat. Mock location sering kali statis sempurna, presisi
 * rendah (diketik manual), tanpa altitude, atau melompat-lompat.
 *
 * - hard   : alasan penolakan langsung (absen tidak disimpan)
 * - flags  : indikasi mencurigakan → status "review" bila skor >= 2
 */

export const FLAG_WEIGHTS = {
  koordinat_statis: 2,
  presisi_rendah: 2,
  lompatan_lokasi: 2,
  kecepatan_tidak_wajar: 2,
  teleport: 2,
  perangkat_dipakai_orang_lain: 2,
  kamera_virtual: 2,
  otomasi_browser: 2,
  altitude_kosong: 1,
  timestamp_tidak_wajar: 1,
  jam_perangkat_beda: 1,
  sampel_sedikit: 1,
};

const decimals = (n) => {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function sanitizeSamples(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-30)
    .filter((s) => s && isNum(s.lat) && isNum(s.lng) && isNum(s.accuracy))
    .filter((s) => Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180 && s.accuracy >= 0)
    .map((s) => ({
      lat: s.lat,
      lng: s.lng,
      accuracy: s.accuracy,
      altitude: isNum(s.altitude) ? s.altitude : null,
      altitudeAccuracy: isNum(s.altitudeAccuracy) ? s.altitudeAccuracy : null,
      speed: isNum(s.speed) ? s.speed : null,
      ts: isNum(s.ts) ? s.ts : null, // position.timestamp dari perangkat
      at: isNum(s.at) ? s.at : null, // Date.now() perangkat saat diterima
    }));
}

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/**
 * Pilih venue yang cocok: venue terdekat yang radiusnya mencakup posisi.
 * Bila tidak ada, kembalikan venue terdekat (untuk pesan penolakan).
 */
export function matchVenue(lat, lng, venues) {
  let inside = null;
  let nearest = null;
  for (const v of venues) {
    const d = haversine(lat, lng, v.lat, v.lng);
    if (!nearest || d < nearest.distance) nearest = { venue: v, distance: d };
    if (d <= v.radius_m && (!inside || d < inside.distance)) inside = { venue: v, distance: d };
  }
  return inside ? { ...inside, inside: true } : nearest ? { ...nearest, inside: false } : null;
}

/**
 * @param venues  venue yang BOLEH dipakai orang ini di sesi ini
 * @param opts.maxAccuracy  batas akurasi GPS (meter)
 */
export function analyzeLocation(samples, venues, { maxAccuracy, clientTime } = {}) {
  const hard = [];
  const flags = [];
  const add = (code, detail) => flags.push({ code, detail });

  if (!samples.length) {
    return { hard: ['Data lokasi tidak diterima. Aktifkan GPS dan izinkan akses lokasi.'], flags };
  }

  const lat = median(samples.map((s) => s.lat));
  const lng = median(samples.map((s) => s.lng));
  const bestAcc = Math.min(...samples.map((s) => s.accuracy));
  const match = matchVenue(lat, lng, venues);
  const distance = match?.distance ?? null;

  // ---- Penolakan langsung ----
  if (bestAcc > maxAccuracy) {
    hard.push(
      `Akurasi GPS terlalu rendah (±${Math.round(bestAcc)} m, maks ${maxAccuracy} m). ` +
        'Aktifkan mode lokasi akurasi tinggi dan pindah ke area terbuka.'
    );
  }
  if (!match) {
    hard.push('Tidak ada venue yang ditetapkan untuk Anda di sesi ini. Hubungi panitia.');
  } else if (!match.inside) {
    hard.push(
      `Anda berada ${fmtDist(match.distance)} dari venue terdekat (${match.venue.name}, maks ${match.venue.radius_m} m).`
    );
  }

  // ---- Indikasi fake GPS ----
  const n = samples.length;
  if (n < 3) add('sampel_sedikit', `Hanya ${n} sampel lokasi`);

  if (n >= 3) {
    const first = samples[0];
    const identical = samples.every(
      (s) => s.lat === first.lat && s.lng === first.lng && s.accuracy === first.accuracy
    );
    if (identical) add('koordinat_statis', `${n} sampel identik persis (GPS asli selalu bergoyang)`);
  }

  if (samples.every((s) => decimals(s.lat) <= 4 && decimals(s.lng) <= 4)) {
    add('presisi_rendah', 'Koordinat ≤4 desimal (pola koordinat yang diketik manual)');
  }

  if (bestAcc <= 20 && samples.every((s) => s.altitude === null)) {
    add('altitude_kosong', 'Mengaku akurasi GPS tinggi tetapi tanpa data ketinggian');
  }

  for (let i = 1; i < n; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const d = haversine(a.lat, a.lng, b.lat, b.lng);
    const dt = a.at && b.at ? Math.max((b.at - a.at) / 1000, 0.5) : 1;
    const tolerance = 50 + 2 * Math.max(a.accuracy, b.accuracy);
    if (d > tolerance && d / dt > 15) {
      add('lompatan_lokasi', `Lokasi melompat ${Math.round(d)} m dalam ${dt.toFixed(1)} dtk`);
      break;
    }
  }

  if (samples.some((s) => s.speed !== null && s.speed > 40)) {
    add('kecepatan_tidak_wajar', 'Kecepatan perangkat > 144 km/jam saat absen');
  }

  const stale = samples.some((s) => s.ts && s.at && Math.abs(s.at - s.ts) > 120_000);
  const frozen = n >= 3 && samples.every((s) => s.ts && s.ts === samples[0].ts);
  if (stale || frozen) {
    add('timestamp_tidak_wajar', stale ? 'Timestamp lokasi kedaluwarsa' : 'Timestamp lokasi tidak berubah');
  }

  if (clientTime) {
    const diff = Math.abs(Date.now() - new Date(clientTime).getTime());
    if (Number.isFinite(diff) && diff > 5 * 60_000) {
      add('jam_perangkat_beda', `Jam perangkat selisih ${Math.round(diff / 60000)} menit dari server`);
    }
  }

  return { lat, lng, accuracy: bestAcc, distance, venue: match?.inside ? match.venue : null, hard, flags };
}

const VIRTUAL_CAM = /(virtual|obs|manycam|droidcam|snap ?camera|xsplit|epoccam|iriun|camo|ndi|v4l2loopback|dummy|fake)/i;

export function analyzeClientMeta(meta = {}) {
  const flags = [];
  if (typeof meta.cameraLabel === 'string' && VIRTUAL_CAM.test(meta.cameraLabel)) {
    flags.push({ code: 'kamera_virtual', detail: `Kamera: ${meta.cameraLabel.slice(0, 80)}` });
  }
  if (meta.webdriver === true) {
    flags.push({ code: 'otomasi_browser', detail: 'Browser dikendalikan otomatis (webdriver)' });
  }
  return flags;
}

export const scoreOf = (flags) => flags.reduce((s, f) => s + (FLAG_WEIGHTS[f.code] || 1), 0);

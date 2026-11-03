// Siapkan 8 venue BIMTEK dengan nama yang sama seperti di data peserta & LO.
// Jalankan:  npm --prefix server run seed-venues   (aman dijalankan berulang kali)
//
// - Venue yang sudah ada (mis. "EL HOTEL", "Grand Mercure Harmoni", "Hotel Makassar") hanya
//   DIGANTI NAMANYA; koordinat, radius, status, akun LO, dan kode venuenya tetap.
// - Venue yang belum ada dibuat dengan koordinat PERKIRAAN dan status NONAKTIF.
//   Cek titiknya di menu Venue → Ubah (tempel koordinat dari Google Maps), lalu centang Aktif.
import 'dotenv/config';
import { q, pool } from './db.js';

const VENUES = [
  { name: 'Grand Mercure Jakarta Harmoni', match: /harmoni/i,
    address: 'Jl. Hayam Wuruk No. 36-37, Gambir, Jakarta Pusat', lat: -6.16020, lng: 106.81468 },
  { name: 'Sunlake Sunter', match: /sun\s*lake|sunter/i,
    address: 'Jl. Danau Permai Raya Blok C-1, Sunter, Tanjung Priok, Jakarta Utara', lat: -6.14530, lng: 106.86900 },
  { name: 'Holiday Inn & Suites Jakarta Gajah Mada', match: /holiday|gajah\s*mada/i,
    address: 'Jl. Gajah Mada No. 211, Glodok, Taman Sari, Jakarta Barat', lat: -6.14900, lng: 106.81500 },
  { name: 'Mercure Jakarta Batavia', match: /batavia/i,
    address: 'Jl. Kali Besar Barat No. 44-46, Kota Tua, Jakarta Barat', lat: -6.13550, lng: 106.81150 },
  { name: 'Mercure Convention Center Ancol', match: /ancol/i,
    address: 'Jl. Pantai Indah, Taman Impian Jaya Ancol, Pademangan, Jakarta Utara', lat: -6.12350, lng: 106.84200 },
  { name: 'El Hotel Jakarta', match: /^el\b|el\s*hotel|el\s*royale/i,
    address: 'Jl. Boulevard Raya, Kelapa Gading, Jakarta Utara', lat: -6.15224, lng: 106.89341 },
  { name: 'Luminor Mangga Besar', match: /luminor|mangga\s*besar/i,
    address: 'Mangga Besar, Jakarta Barat', lat: -6.14700, lng: 106.81800 },
  { name: 'Claro Hotel Makasar', match: /claro|makas+ar/i,
    address: 'Jl. A. P. Pettarani No. 3, Makassar, Sulawesi Selatan', lat: -5.15570, lng: 119.43260 },
];

// Info koneksi (tanpa password) + coba ulang bila koneksi pooler terputus sesaat
const url = new URL(process.env.DATABASE_URL || 'postgres://-');
console.log(`Terhubung ke ${url.hostname}:${url.port || 5432} (SSL ${process.env.PGSSL === 'true' ? 'aktif' : 'TIDAK aktif — isi PGSSL=true di .env'})`);
let existing;
for (let i = 1; ; i++) {
  try { ({ rows: existing } = await q('SELECT id, name, lat, lng, active FROM venues ORDER BY id')); break; }
  catch (e) {
    if (i >= 3) { console.error(`Gagal terhubung ke database: ${e.code || ''} ${e.message}`); await pool.end(); process.exit(1); }
    console.log(`Koneksi gagal (${e.code || e.message}), mencoba lagi…`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const used = new Set();
for (const v of VENUES) {
  const found = existing.find((e) => !used.has(e.id) && (e.name === v.name || v.match.test(e.name)));
  if (found) {
    used.add(found.id);
    if (found.name !== v.name) {
      await q('UPDATE venues SET name=$1 WHERE id=$2', [v.name, found.id]);
      console.log(`✎ "${found.name}" → "${v.name}" (koordinat ${found.lat}, ${found.lng} tetap)`);
    } else console.log(`✓ "${v.name}" sudah ada`);
  } else {
    await q('INSERT INTO venues (name, address, lat, lng, radius_m, active) VALUES ($1,$2,$3,$4,150,FALSE)',
      [v.name, v.address, v.lat, v.lng]);
    console.log(`+ "${v.name}" dibuat NONAKTIF dengan koordinat perkiraan ${v.lat}, ${v.lng} — cek & aktifkan di menu Venue`);
  }
}
const others = existing.filter((e) => !used.has(e.id));
if (others.length) console.log('Venue lain dibiarkan:', others.map((e) => e.name).join(', '));
console.log('\nSelesai. Impor ulang file peserta (dan CSV LO) agar orang tertaut ke venue.');
await pool.end();

/**
 * Pembacaan CSV peserta/panitia untuk impor.
 * Tiga format yang dikenali otomatis:
 *  1. Tanpa header / header lama → urutan kolom: kode,nama,peran,instansi,jabatan,telepon,venue
 *  2. Dengan header → kolom dicocokkan berdasarkan nama (lihat HEADER_ALIASES), urutan bebas
 *  3. File "Pemetaan Sekolah" (kolom Bendahara + Pengawas) → otomatis dipecah menjadi
 *     peserta Bendahara (1 per sekolah) dan Pengawas (1 per orang, bisa membawahi beberapa sekolah)
 */

export const EXTRA_FIELDS = ['region', 'ruangan', 'npsn', 'provinsi', 'kab_kota', 'ptn',
  'koor_pelaporan', 'fasil_pelaporan', 'peringkat', 'notes'];

/** Parser CSV lengkap: tanda kutip, "" di dalam kutip, baris baru di dalam kutip, pemisah , ; atau tab */
export function parseRows(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const count = (ch) => first.split(ch).length - 1;
  const sep = [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows = [];
  let row = [], cur = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n') { row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur.trim());
  rows.push(row);
  return rows.filter((r) => r.some((x) => x !== ''));
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const HEADER_ALIASES = {
  code: ['kode', 'code', 'kodepeserta', 'nomorpeserta', 'nopeserta', 'id'],
  name: ['nama', 'name', 'namalengkap'],
  role: ['peran', 'role'],
  institution: ['instansi', 'sekolah', 'namasekolah', 'instansisekolah'],
  position: ['jabatan', 'position'],
  phone: ['telepon', 'telp', 'nohp', 'hp', 'phone', 'nomorhp'],
  venue: ['venue', 'hotel', 'lokasi'],
  region: ['region', 'regional', 'wilayah'],
  ruangan: ['ruangan', 'ruang', 'room'],
  npsn: ['npsn'],
  provinsi: ['provinsi', 'prov'],
  kab_kota: ['kabkota', 'kabupatenkota', 'kabupaten', 'kota'],
  ptn: ['ptn', 'perguruantinggi'],
  koor_pelaporan: ['koorpelaporan', 'koordinatorpelaporan'],
  fasil_pelaporan: ['fasilpelaporan', 'fasilitatorpelaporan'],
  peringkat: ['peringkat', 'ranking', 'rank'],
  notes: ['catatan', 'notes', 'keterangan'],
};
const ALIAS_TO_FIELD = new Map(Object.entries(HEADER_ALIASES).flatMap(([f, al]) => al.map((a) => [a, f])));
const LEGACY = ['code', 'name', 'role', 'institution', 'position', 'phone', 'venue'];

/** Nama hotel di file pemetaan → nama venue yang dipakai di aplikasi (sama dengan data LO) */
export const HOTEL_ALIAS = {
  mercureharmoni: 'Grand Mercure Jakarta Harmoni',
  sunlakesunter: 'Sunlake Sunter',
  holidayinngajahmada: 'Holiday Inn & Suites Jakarta Gajah Mada',
  mercurejakartabatavia: 'Mercure Jakarta Batavia',
  mercureancol: 'Mercure Convention Center Ancol',
  elhoteljakarta: 'El Hotel Jakarta',
  hotelluminormanggabesar: 'Luminor Mangga Besar',
  clarohotelmakassar: 'Claro Hotel Makasar',
};
const hotelName = (h) => HOTEL_ALIAS[norm(h)] || String(h || '').trim();

/** Ubah teks CSV menjadi daftar objek orang + info format */
export function parsePeople(text) {
  const rows = parseRows(text);
  if (!rows.length) return { format: 'kosong', people: [] };
  const head = rows[0].map(norm);

  // Format 3: file Pemetaan Sekolah
  if (head.includes('bendahara') && head.some((h) => h.startsWith('pengawas'))) {
    const people = fromPemetaan(rows);
    return { format: 'pemetaan', people, skipped: people.skipped };
  }

  // Format 2: ada header yang dikenali (minimal kolom nama)
  const mapped = head.map((h) => ALIAS_TO_FIELD.get(h) || null);
  if (mapped.includes('name')) {
    return {
      format: 'header',
      people: rows.slice(1).map((r) => Object.fromEntries(mapped.map((f, i) => [f, r[i]]).filter(([f]) => f))),
    };
  }

  // Format 1: urutan tetap (header lama dilewati)
  const body = /^(kode.*|code|nik|nip|no\.?|nomor.*)$/i.test(rows[0][0]) ? rows.slice(1) : rows;
  return { format: 'urutan', people: body.map((r) => Object.fromEntries(LEGACY.map((f, i) => [f, r[i]]))) };
}

/**
 * Pemetaan Sekolah → peserta.
 *  - Bendahara: 1 orang per sekolah, kode B-<NPSN>
 *  - Pengawas: dikelompokkan menurut kolom "Nama Gabungan (dipakai untuk kursi)"; satu pengawas bisa
 *    membawahi beberapa sekolah. Kode P-<NPSN terkecil>; saat absen, P-<NPSN sekolah mana pun> juga diterima.
 *  - "Perencana (tidak diundang)" diabaikan.
 */
export function fromPemetaan(rows) {
  const head = rows[0].map(norm);
  const col = (...names) => {
    for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
    for (const n of names) { const i = head.findIndex((h) => h.startsWith(n)); if (i >= 0) return i; }
    return -1;
  };
  const C = {
    region: col('region'), hotel: col('hotel'), ruangan: col('ruangan'), peringkat: col('peringkat'),
    npsn: col('npsn'), sekolah: col('namasekolah', 'sekolah'), provinsi: col('provinsi'), kab_kota: col('kabkota'),
    ptn: col('ptn'), koor: col('koorpelaporan'), fasil: col('fasilpelaporan'), bendahara: col('bendahara'),
    pengawas: col('pengawas'), gabungan: col('pengawasnamagabungan'), status: col('statusnamapengawas'),
  };
  const get = (r, k) => (C[k] >= 0 ? String(r[C[k]] ?? '').trim() : '');
  // nama kosong/penanda seperti "(BELUM ADA)", "-", "tidak ada" → dilewati
  const isPlaceholder = (n) => !/[a-z]/i.test(n) || /^\(?\s*(belum ada|tidak ada|kosong|n\/?a|tbd|-)\s*\)?$/i.test(n);
  let skipped = 0;
  const out = [];
  const groups = new Map();

  for (const r of rows.slice(1)) {
    const npsn = get(r, 'npsn');
    if (!npsn) continue;
    const base = {
      region: get(r, 'region'), venue: hotelName(get(r, 'hotel')), hotel: get(r, 'hotel'), ruangan: get(r, 'ruangan'),
      npsn, institution: get(r, 'sekolah'), provinsi: get(r, 'provinsi'), kab_kota: get(r, 'kab_kota'),
      ptn: get(r, 'ptn'), koor_pelaporan: get(r, 'koor'), fasil_pelaporan: get(r, 'fasil'), peringkat: get(r, 'peringkat'),
    };
    const bendahara = get(r, 'bendahara');
    if (bendahara && isPlaceholder(bendahara)) skipped++;
    else if (bendahara) out.push({ ...base, code: `B-${npsn}`, name: bendahara, role: 'peserta', position: 'Bendahara' });

    const pengawas = get(r, 'gabungan') || get(r, 'pengawas');
    if (pengawas && isPlaceholder(pengawas)) skipped++;
    else if (pengawas) {
      // kunci = nama persis (abaikan huruf besar/kecil & spasi ganda); penggabungan nama
      // sudah diputuskan di kolom "Nama Gabungan", jadi tidak digabung lebih jauh di sini
      const key = pengawas.toLowerCase().replace(/\s+/g, ' ');
      if (!groups.has(key)) groups.set(key, { name: pengawas, schools: [], statuses: new Set() });
      const g = groups.get(key);
      g.schools.push(base);
      const st = get(r, 'status');
      if (st && !/^sama dengan data sumber$/i.test(st)) g.statuses.add(st);
    }
  }

  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const join = (arr) => uniq(arr).join('; ');
  for (const g of groups.values()) {
    const s = g.schools.sort((a, b) => a.npsn.localeCompare(b.npsn));
    const places = uniq(s.map((x) => `${x.venue}|${x.ruangan}`));
    const venues = uniq(s.map((x) => x.venue));
    const notes = [...g.statuses];
    if (venues.length > 1) notes.push(`Terdaftar di ${venues.length} hotel (${venues.join(', ')}) — venue dibebaskan, mohon dicek`);
    out.push({
      code: `P-${s[0].npsn}`, name: g.name, role: 'peserta', position: 'Pengawas',
      institution: join(s.map((x) => x.institution)),
      npsn: join(s.map((x) => x.npsn)),
      region: join(s.map((x) => x.region)),
      venue: venues.length === 1 ? venues[0] : '',
      ruangan: places.length === 1 ? s[0].ruangan
        : venues.length === 1 ? join(s.map((x) => x.ruangan))
          : join(s.map((x) => `${x.venue}: ${x.ruangan}`)),
      provinsi: join(s.map((x) => x.provinsi)),
      kab_kota: join(s.map((x) => x.kab_kota)),
      ptn: join(s.map((x) => x.ptn)),
      koor_pelaporan: join(s.map((x) => x.koor_pelaporan)),
      fasil_pelaporan: join(s.map((x) => x.fasil_pelaporan)),
      peringkat: join(s.map((x) => x.peringkat)),
      notes: notes.join('; '),
    });
  }
  out.skipped = skipped;
  return out;
}

import { q } from './db.js';
import { HttpError } from './util.js';

const key = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolKey = (value) => key(String(value ?? '').toLowerCase().replace(/\bsd\s*n(?=\s|\d|[.-])/g, 'sd negeri '));
const aliases = { hotelatriatangerang: 'atriatangerang', mercurebatavia: 'mercurejakartabatavia', sahidrayajogja: 'sahidjayajogja' };
const roles = {
  sekolah: 'bendahara', bendahara: 'bendahara', pengawas: 'pengawas', dinaspendidikan: 'dinaspendidikan',
  fasil: 'fasilitator', fasilitator: 'fasilitator', bbpmp: 'bbpmp', bpmp: 'bbpmp',
};
const priority = { sedang_antre: 1, sudah_tiba: 2, selesai: 3 };
const states = { selesai: 'selesai', sudahtiba: 'sudah_tiba', sedangantri: 'sedang_antre', sedangantre: 'sedang_antre' };

export async function getArrivalRecap(user) {
  const { rows } = await q(`SELECT v.id, v.name, r.imported_at,
    (SELECT count(*)::int FROM jsonb_each_text(r.marks) m
      JOIN people p ON p.id=m.key::int AND p.venue_id=v.id AND p.archived_at IS NULL
      WHERE m.value IN ('selesai','sudah_tiba')) AS arrived,
    (SELECT count(*)::int FROM jsonb_each_text(r.marks) m
      JOIN people p ON p.id=m.key::int AND p.venue_id=v.id AND p.archived_at IS NULL
      WHERE m.value='sedang_antre') AS queued
    FROM venues v LEFT JOIN venue_arrival_recap r ON r.venue_id=v.id
    WHERE ($1::int IS NULL OR v.id=$1) ORDER BY v.name`, [user.role === 'lo' ? user.venue : null]);
  return rows;
}

export async function importArrivalRecap(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 20_000 ||
    rows.some((row) => !Array.isArray(row) || row.length !== 5 || row.some((value) => typeof value !== 'string' || value.length > 400))) {
    throw new HttpError(400, 'Data Detail Peserta tidak valid.');
  }
  const [{ rows: venues }, { rows: people }] = await Promise.all([
    q('SELECT id,name FROM venues'),
    q(`SELECT id, venue_id, position, name, institution FROM people
       WHERE role='peserta' AND archived_at IS NULL AND venue_id IS NOT NULL`),
  ]);
  const byVenue = new Map(venues.map((v) => [key(v.name), v]));
  const index = new Map();
  for (const p of people) {
    const role = roles[key(p.position)];
    if (!role) continue;
    const identity = ['bendahara', 'dinaspendidikan', 'bbpmp'].includes(role) ? schoolKey(p.institution) : key(p.name);
    if (!identity) continue;
    const id = `${p.venue_id}:${role}:${identity}`;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(p);
  }
  const snapshots = new Map();
  let unmatched = 0;
  let markedRows = 0;
  for (const [hotel, rawRole, name, institution, rawArrival] of rows) {
    const hotelKey = key(hotel.split(/\s+[-–—]\s+/).at(-1));
    const venue = byVenue.get(aliases[hotelKey] || hotelKey);
    if (!venue) throw new HttpError(400, `Venue di Excel tidak ditemukan di aplikasi: ${hotel || '(kosong)'}.`);
    if (!snapshots.has(venue.id)) snapshots.set(venue.id, { venue_id: venue.id, marks: {}, candidates: 0, name: venue.name });
    const snapshot = snapshots.get(venue.id);
    const arrival = states[key(rawArrival)];
    if (!arrival) continue;
    snapshot.candidates++;
    markedRows++;
    const role = roles[key(rawRole)];
    const identity = ['bendahara', 'dinaspendidikan', 'bbpmp'].includes(role) ? schoolKey(institution) : key(name);
    let matches = index.get(`${venue.id}:${role}:${identity}`) || [];
    if (matches.length > 1 && institution) matches = matches.filter((p) =>
      p.institution?.split(';').some((part) => schoolKey(part) === schoolKey(institution)));
    if (matches.length !== 1) {
      unmatched++;
      continue;
    }
    const id = matches[0].id;
    if (priority[arrival] > (priority[snapshot.marks[id]] || 0)) snapshot.marks[id] = arrival;
  }
  const snapshotsToSave = [...snapshots.values()];
  if (markedRows && markedRows === unmatched) throw new HttpError(400, 'Peserta yang hadir di Excel belum bisa dicocokkan dengan daftar aplikasi.');
  const unsafe = snapshotsToSave.find((row) => row.candidates && !Object.keys(row.marks).length);
  if (unsafe) throw new HttpError(400, `Peserta hadir di ${unsafe.name} belum bisa dicocokkan. Periksa data Excel.`);
  await q(`INSERT INTO venue_arrival_recap (venue_id,marks)
    SELECT venue_id,marks FROM jsonb_to_recordset($1::jsonb) AS v(venue_id int,marks jsonb) ORDER BY venue_id
    ON CONFLICT (venue_id) DO UPDATE SET marks=EXCLUDED.marks, imported_at=now()`, [JSON.stringify(snapshotsToSave)]);
  const matched = snapshotsToSave.reduce((sum, row) => sum + Object.keys(row.marks).length, 0);
  return { matched, unmatched, venues: snapshotsToSave.length };
}

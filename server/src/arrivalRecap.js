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
const sourcePositions = {
  bendahara: 'Bendahara', pengawas: 'Pengawas', dinaspendidikan: 'Dinas Pendidikan',
  fasilitator: 'Fasilitator', bbpmp: 'BB/BPMP',
};
const detailRows = `(
  SELECT DISTINCT ON (school, CASE WHEN school IS NULL THEN id END)
    id, name, position, institution, arrival_status
  FROM (
    SELECT source.*, CASE WHEN position='Bendahara' THEN
      NULLIF(regexp_replace(lower(trim(institution)), '[[:space:]]+', ' ', 'g'), '')
    END AS school
    FROM jsonb_to_recordset(r.detail_rows)
      AS source(id int, name text, position text, institution text, arrival_status text)
  ) entries
  ORDER BY school, CASE WHEN school IS NULL THEN id END,
    array_position(ARRAY['selesai','sudah_tiba','sedang_antre'], arrival_status) NULLS LAST,
    id DESC
) p`;

export async function getArrivalRecap() {
  const { rows } = await q(`WITH detail_breakdown AS (
    SELECT r.venue_id, p.position,
      count(*)::int AS invited,
      count(*) FILTER (WHERE p.arrival_status IN ('selesai','sudah_tiba'))::int AS arrived,
      count(*) FILTER (WHERE p.arrival_status='sedang_antre')::int AS queued
    FROM venue_arrival_recap r CROSS JOIN LATERAL ${detailRows}
    GROUP BY r.venue_id, p.position
  ), breakdown AS (
    SELECT d.* FROM detail_breakdown d JOIN venue_arrival_recap r ON r.venue_id=d.venue_id
    WHERE r.source_summary IS NULL
    UNION ALL
    SELECT r.venue_id,b.position,b.invited,b.arrived,b.queued
    FROM venue_arrival_recap r CROSS JOIN LATERAL jsonb_to_recordset(r.source_summary)
      AS b(position text,invited int,arrived int,queued int)
  )
  SELECT v.id, v.name, r.imported_at, r.detail_rows IS NOT NULL AS source_ready,
    COALESCE(sum(b.invited),0)::int AS invited,
    COALESCE(sum(b.arrived),0)::int AS arrived,
    COALESCE(sum(b.queued),0)::int AS queued,
    COALESCE(json_agg(b ORDER BY b.position) FILTER (
      WHERE lower(b.position) IN ('bendahara','pengawas','dinas pendidikan')
    ), '[]') AS breakdown
  FROM venues v LEFT JOIN venue_arrival_recap r ON r.venue_id=v.id
  LEFT JOIN breakdown b ON b.venue_id=v.id
  GROUP BY v.id, v.name, r.imported_at, r.detail_rows IS NOT NULL ORDER BY v.name`);
  return rows;
}

export async function getArrivalRecapDetails(rawVenueId, group) {
  const venueId = Number(rawVenueId);
  if (!Number.isInteger(venueId) || venueId < 1 || venueId > 2147483647 ||
    !['invited', 'arrived', 'queued'].includes(group)) {
    throw new HttpError(400, 'Filter daftar kehadiran tidak valid.');
  }
  const { rows } = await q(`SELECT p.*
    FROM venue_arrival_recap r CROSS JOIN LATERAL ${detailRows}
    WHERE r.venue_id=$1 AND ($2='invited'
      OR ($2='arrived' AND p.arrival_status IN ('selesai','sudah_tiba'))
      OR ($2='queued' AND p.arrival_status='sedang_antre'))
    ORDER BY p.name, p.id`, [venueId, group]);
  return rows;
}

export async function importArrivalRecap(rows, summary = null) {
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
  const resolveVenue = (hotel) => {
    const hotelKey = key(hotel.split(/\s+[-–—]\s+/).at(-1));
    return byVenue.get(aliases[hotelKey] || hotelKey);
  };
  const summaries = new Map();
  if (summary !== null) {
    if (!Array.isArray(summary) || !summary.length || summary.length > 1000) throw new HttpError(400, 'Ringkasan tidak valid.');
    for (const row of summary) {
      if (!row || typeof row.hotel !== 'string' || !['Bendahara','Pengawas','Dinas Pendidikan'].includes(row.position)
        || ['invited','arrived','queued'].some((field) => !Number.isInteger(row[field]) || row[field] < 0 || row[field] > 20000)
        || row.queued > row.arrived || row.arrived > row.invited) throw new HttpError(400, 'Angka Ringkasan tidak valid.');
      const venue = resolveVenue(row.hotel);
      if (!venue) throw new HttpError(400, `Venue Ringkasan tidak ditemukan: ${row.hotel}`);
      const entries = summaries.get(venue.id) || [];
      if (entries.some((entry) => entry.position === row.position)) throw new HttpError(400, 'Peran Ringkasan ganda pada venue yang sama.');
      entries.push({ position: row.position, invited: row.invited, arrived: row.arrived - row.queued, queued: row.queued });
      summaries.set(venue.id, entries);
    }
  }
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
  const proposals = [];
  let unmatched = 0;
  for (const [hotel, rawRole, name, institution, rawArrival] of rows) {
    const venue = resolveVenue(hotel);
    if (!venue) throw new HttpError(400, `Venue di Excel tidak ditemukan di aplikasi: ${hotel || '(kosong)'}.`);
    if (!snapshots.has(venue.id)) snapshots.set(venue.id, { venue_id: venue.id, marks: {}, representatives: {}, detail_rows: [] });
    const snapshot = snapshots.get(venue.id);
    const arrival = states[key(rawArrival)];
    const role = roles[key(rawRole)];
    snapshot.detail_rows.push({
      id: snapshot.detail_rows.length + 1,
      name, institution, position: sourcePositions[role] || rawRole,
      arrival_status: arrival || null,
    });
    if (!arrival) continue;
    const identity = ['bendahara', 'dinaspendidikan', 'bbpmp'].includes(role) ? schoolKey(institution) : key(name);
    let matches = index.get(`${venue.id}:${role}:${identity}`) || [];
    if (matches.length > 1 && institution) matches = matches.filter((p) =>
      p.institution?.split(';').some((part) => schoolKey(part) === schoolKey(institution)));
    // A substitute may have a different name, but must match exactly one
    // profile for the same school/organization, role, and venue.
    if (!matches.length && schoolKey(institution) && !['-', '(belum ada)'].includes(institution.trim().toLowerCase())) {
      matches = people.filter((p) => p.venue_id === venue.id && roles[key(p.position)] === role &&
        p.institution?.split(';').some((part) => schoolKey(part) === schoolKey(institution)));
    }
    if (matches.length !== 1) {
      unmatched++;
      continue;
    }
    proposals.push({ snapshot, person: matches[0], name, arrival });
  }
  const namesByProfile = new Map();
  for (const { person, name } of proposals) {
    if (!namesByProfile.has(person.id)) namesByProfile.set(person.id, new Set());
    namesByProfile.get(person.id).add(key(name));
  }
  for (const { snapshot, person, name, arrival } of proposals) {
    // Do not choose a representative when the source lists different attendees
    // against the same profile. These entries still need a manual check.
    if (namesByProfile.get(person.id).size !== 1) { unmatched++; continue; }
    const id = person.id;
    if (priority[arrival] > (priority[snapshot.marks[id]] || 0)) snapshot.marks[id] = arrival;
    const plainName = (value) => key(String(value).split(',')[0].replace(/\s+(?:s\.?pd|s\.?t|m\.?pd|m\.?t)\.?$/i, ''));
    if (key(name) && name.trim() !== '-' && plainName(name) !== plainName(person.name)) {
      snapshot.representatives[id] = { name: name.trim(), original_name: person.name };
    }
  }
  const snapshotsToSave = [...snapshots.values()];
  if (summary !== null && (summaries.size !== snapshots.size || [...summaries].some(([id, entries]) => !snapshots.has(id) || entries.length !== 3))) {
    throw new HttpError(400, 'Ringkasan dan Detail Peserta harus mencakup venue yang sama dan tiga peran lengkap.');
  }
  for (const snapshot of snapshotsToSave) snapshot.source_summary = summaries.get(snapshot.venue_id) || null;
  await q(`INSERT INTO venue_arrival_recap (venue_id,marks,detail_rows,source_summary,representatives)
    SELECT venue_id,marks,detail_rows,source_summary,representatives
    FROM jsonb_to_recordset($1::jsonb) AS v(venue_id int,marks jsonb,detail_rows jsonb,source_summary jsonb,representatives jsonb) ORDER BY venue_id
    ON CONFLICT (venue_id) DO UPDATE SET marks=EXCLUDED.marks, detail_rows=EXCLUDED.detail_rows, source_summary=EXCLUDED.source_summary, representatives=EXCLUDED.representatives, imported_at=now()`,
    [JSON.stringify(snapshotsToSave)]);
  const matched = snapshotsToSave.reduce((sum, row) => sum + Object.keys(row.marks).length, 0);
  return { imported: rows.length, matched, unmatched, venues: snapshotsToSave.length };
}

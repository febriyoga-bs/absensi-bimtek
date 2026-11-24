import { q } from './db.js';
import { HttpError } from './util.js';
import { eventVenueScope } from './eventVenues.js';
import { eventId } from './eventContext.js';

const key = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolKey = (value) => key(String(value ?? '').toLowerCase().replace(/\bsd\s*n(?=\s|\d|[.-])/g, 'sd negeri '));
const aliases = {
  hotelatriatangerang: 'atriatangerang', holidayinn: 'holidayinnjakarta',
  mercurebatavia: 'mercurebataviajakarta', mercurejakartabatavia: 'mercurebataviajakarta',
  harrisgubengsby: 'harrisgubengsurabaya', wyndhamhotelsurabaya: 'windhamsurabaya',
  claro: 'claromakassar', fourpointsbysheratonmakassar: 'fourpointmakassar',
  sahidrayajogja: 'sahidjayajogja',
};
export const arrivalVenueKey = (value) => {
  const name = key(String(value ?? '').split(/\s+[-–—]\s+/).at(-1));
  return aliases[name] || name;
};
const roles = {
  sekolah: 'bendahara', bendahara: 'bendahara', pengawas: 'pengawas', dinaspendidikan: 'dinaspendidikan',
  kepalasekolah: 'kepalasekolah', fasil: 'fasilitator', fasilitator: 'fasilitator', bbpmp: 'bbpmp', bpmp: 'bbpmp',
};
const priority = { sedang_antre: 1, sudah_tiba: 2, selesai: 3 };
const states = { selesai: 'selesai', sudahtiba: 'sudah_tiba', sedangantri: 'sedang_antre', sedangantre: 'sedang_antre' };
const sourcePositions = {
  bendahara: 'Bendahara', pengawas: 'Pengawas', dinaspendidikan: 'Dinas Pendidikan',
  kepalasekolah: 'Kepala Sekolah', fasilitator: 'Fasilitator', bbpmp: 'BB/BPMP',
};

export async function getSchoolArrivalStatuses(schools) {
  const { rows } = await q(`SELECT v.name AS venue, p.name, p.position, p.institution, p.arrival_status
    FROM venue_arrival_recap r JOIN venues v ON v.id=r.venue_id
    CROSS JOIN LATERAL jsonb_to_recordset(r.detail_rows)
      AS p(name text, position text, institution text, arrival_status text)
    WHERE ${eventVenueScope('v')} AND p.position IN ('Bendahara', 'Kepala Sekolah')`);
  const schoolIdentity = (venue, name) => JSON.stringify([arrivalVenueKey(venue), schoolKey(name)]);
  const bySchool = new Map();
  const attendeeKey = value => key(String(value ?? '').split(',')[0]);
  for (const row of rows) {
    if (!schoolKey(row.institution)) continue;
    const identity = schoolIdentity(row.venue, row.institution);
    if (!bySchool.has(identity)) bySchool.set(identity, new Map());
    const attendees = bySchool.get(identity);
    const name = attendeeKey(row.name);
    if (!name) continue;
    const previous = attendees.get(name);
    if (!previous || (priority[row.arrival_status] || 0) > (priority[previous.arrival_status] || 0)) {
      attendees.set(name, row);
    }
  }
  return schools.map(school => {
    const attendees = bySchool.get(schoolIdentity(school.venue, school.name)) || new Map();
    const head = attendeeKey(school.head_name);
    const isHead = (name, row) => row.position === 'Kepala Sekolah' || name === head;
    const canInferTreasurer = attendees.size === 2 && [...attendees].filter(([name, row]) => isHead(name, row)).length === 1;
    const arrival_attendees = [...attendees].map(([name, row]) => ({
      name: row.name,
      role: isHead(name, row) ? 'Kepala Sekolah' : canInferTreasurer ? 'Bendahara' : 'Peserta sekolah',
      status: row.arrival_status || 'belum_tercatat',
    }));
    const arrival_status = arrival_attendees.reduce((best, { status }) =>
      !best || (priority[status] || 0) > (priority[best] || 0) ? status : best, null);
    return { ...school, arrival_status, arrival_attendees };
  });
}
export function validateArrivalSummaryRow(row) {
  if (!row || typeof row.hotel !== 'string' || !row.hotel.trim() || !['Bendahara','Pengawas','Dinas Pendidikan'].includes(row.position)
    || ['invited','arrived','queued'].some((field) => !Number.isInteger(row[field]) || row[field] < 0 || row[field] > 20000)
    || row.queued > row.arrived) {
    throw new HttpError(400, `Ringkasan tidak valid: ${row?.hotel || 'venue kosong'} / ${row?.position || 'peran kosong'}. Periksa angka undangan, tiba, dan antre; antre tidak boleh melebihi tiba.`);
  }
  return row.arrived > row.invited
    ? `${row.hotel} / ${row.position}: ${row.arrived} sudah tiba (termasuk antre), melebihi ${row.invited} undangan/akun. Angka sumber dipertahankan; perlu diperiksa.` : null;
}
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
  WHERE ${eventVenueScope('v')}
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
    FROM venue_arrival_recap r JOIN venues v ON v.id=r.venue_id CROSS JOIN LATERAL ${detailRows}
    WHERE ${eventVenueScope('v')} AND r.venue_id=$1 AND ($2='invited'
      OR ($2='arrived' AND p.arrival_status IN ('selesai','sudah_tiba'))
      OR ($2='queued' AND p.arrival_status='sedang_antre'))
    ORDER BY p.name, p.id`, [venueId, group]);
  return rows;
}

export async function importArrivalRecap(rows, summary = null) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 20_000 ||
    rows.some((row) => !Array.isArray(row) || ![5, 6].includes(row.length) || row.some((value) => typeof value !== 'string' || value.length > 400))) {
    throw new HttpError(400, 'Data Detail Peserta tidak valid.');
  }
  const [{ rows: venues }, { rows: people }] = await Promise.all([
    q('SELECT id,name FROM venues'),
    q(`SELECT id, venue_id, position, name, institution,
       EXISTS(SELECT 1 FROM attendance a WHERE a.person_id=people.id AND a.venue_id=people.venue_id) AS has_attendance
       FROM people
       WHERE role='peserta' AND archived_at IS NULL AND venue_id IS NOT NULL`),
  ]);
  const byVenue = new Map(venues.map((v) => [arrivalVenueKey(v.name), v]));
  const resolveVenue = (hotel) => {
    return byVenue.get(arrivalVenueKey(hotel));
  };
  const summaries = new Map();
  const warnings = [];
  if (summary !== null) {
    if (!Array.isArray(summary) || !summary.length || summary.length > 1000) throw new HttpError(400, 'Ringkasan tidak valid.');
    for (const row of summary) {
      const warning = validateArrivalSummaryRow(row);
      if (warning) warnings.push(warning);
      const venue = resolveVenue(row.hotel);
      if (!venue) throw new HttpError(400, `Venue Ringkasan tidak ditemukan: ${row.hotel}`);
      const entries = summaries.get(venue.id) || [];
      const existing = entries.find((entry) => entry.position === row.position);
      if (existing) {
        existing.invited += row.invited;
        existing.arrived += row.arrived - row.queued;
        existing.queued += row.queued;
      } else entries.push({ position: row.position, invited: row.invited, arrived: row.arrived - row.queued, queued: row.queued });
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
  const genericSchoolNames = new Map();
  const schoolAttendanceKey = (venue, institution) => JSON.stringify([arrivalVenueKey(venue), schoolKey(institution)]);
  const attendeeNameKey = (name) => key(String(name ?? '').split(',')[0]);
  if (eventId() === 5) {
    for (const [hotel, rawRole, name, institution] of rows) {
      if (key(rawRole) !== 'sekolah' || !attendeeNameKey(name)) continue;
      const identity = schoolAttendanceKey(hotel, institution);
      if (!genericSchoolNames.has(identity)) genericSchoolNames.set(identity, new Set());
      genericSchoolNames.get(identity).add(attendeeNameKey(name));
    }
  }
  let unmatched = 0;
  for (const [hotel, rawRole, name, institution, rawArrival, confirmation] of rows) {
    const venue = resolveVenue(hotel);
    if (!venue) throw new HttpError(400, `Venue di Excel tidak ditemukan di aplikasi: ${hotel || '(kosong)'}.`);
    if (!snapshots.has(venue.id)) snapshots.set(venue.id, { venue_id: venue.id, marks: {}, representatives: {}, detail_rows: [] });
    const snapshot = snapshots.get(venue.id);
    const unconfirmed = key(confirmation) === 'belumkonfirmasi' || (!confirmation && key(rawArrival) === 'belumkonfirmasi');
    const recorded = unconfirmed && people.some(p => p.has_attendance && p.venue_id === venue.id
      && roles[key(p.position)] === roles[key(rawRole)]
      && (key(p.name) === key(name) || (roles[key(rawRole)] === 'bendahara' && schoolKey(institution)
        && (p.institution || '').split(';').some(part => schoolKey(part) === schoolKey(institution)))));
    if (unconfirmed && !recorded) continue;
    const arrival = states[key(rawArrival)];
    let role = roles[key(rawRole)];
    if (eventId() === 5 && key(rawRole) === 'sekolah') {
      const heads = people.filter(p => p.venue_id === venue.id && roles[key(p.position)] === 'kepalasekolah'
        && (p.institution || '').split(';').some(part => schoolKey(part) === schoolKey(institution)));
      if (heads.length === 1) {
        const headName = attendeeNameKey(heads[0].name);
        const sourceNames = genericSchoolNames.get(schoolAttendanceKey(hotel, institution));
        if (headName && attendeeNameKey(name) === headName) role = 'kepalasekolah';
        else if ((sourceNames?.size ?? 0) > 1 && !(sourceNames.size === 2 && sourceNames.has(headName))) role = null;
      }
    }
    snapshot.detail_rows.push({
      id: snapshot.detail_rows.length + 1,
      name, institution, position: sourcePositions[role || roles[key(rawRole)]] || rawRole,
      arrival_status: arrival || (key(rawArrival) === 'belumtiba' ? 'belum_tiba' : null),
    });
    if (!role && eventId() === 5 && key(rawRole) === 'sekolah') { unmatched++; continue; }
    if (!arrival && !['dinaspendidikan', 'bbpmp'].includes(role)) continue;
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
  const pks = eventId() === 5;
  if (summary !== null && (summaries.size !== snapshots.size || [...summaries].some(([id, entries]) =>
    !snapshots.has(id) || (pks ? !entries.some(entry => entry.position === 'Bendahara') : entries.length !== 3)))) {
    throw new HttpError(400, pks
      ? 'Ringkasan dan Detail Peserta harus mencakup venue yang sama, dengan ringkasan Sekolah di setiap venue.'
      : 'Ringkasan dan Detail Peserta harus mencakup venue yang sama dan tiga peran lengkap.');
  }
  for (const snapshot of snapshotsToSave) snapshot.source_summary = summaries.get(snapshot.venue_id) || null;
  await q(`INSERT INTO venue_arrival_recap (venue_id,marks,detail_rows,source_summary,representatives)
    SELECT venue_id,marks,detail_rows,source_summary,representatives
    FROM jsonb_to_recordset($1::jsonb) AS v(venue_id int,marks jsonb,detail_rows jsonb,source_summary jsonb,representatives jsonb) ORDER BY venue_id
    ON CONFLICT (venue_id) DO UPDATE SET marks=EXCLUDED.marks, detail_rows=EXCLUDED.detail_rows, source_summary=EXCLUDED.source_summary, representatives=EXCLUDED.representatives, imported_at=now()`,
    [JSON.stringify(snapshotsToSave)]);
  const matched = snapshotsToSave.reduce((sum, row) => sum + Object.keys(row.marks).length, 0);
  return { imported: rows.length, matched, unmatched, venues: snapshotsToSave.length, warnings,
    representatives: snapshotsToSave.reduce((sum, snapshot) => sum + Object.keys(snapshot.representatives).length, 0) };
}

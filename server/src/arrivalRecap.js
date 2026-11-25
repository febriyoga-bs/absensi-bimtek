import { q } from './db.js';
import { HttpError } from './util.js';
import { eventVenueScope } from './eventVenues.js';
import { eventId } from './eventContext.js';
import { arrivalSchoolOverride, schoolHeadOverride } from './arrivalSchoolOverrides.js';
import { arrivalPersonKey as attendeeNameKey } from '../../shared/pksAttendeeName.js';

const key = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolKey = (value) => key(String(value ?? '').toLowerCase().replace(/\bsd\s*n(?=\s|\d|[.-])/g, 'sd negeri '));
// Nama di rekap bisa memuat beberapa gelar yang tidak ada di daftar sekolah.
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
const priority = { belum_tiba: 1, sedang_antre: 2, sudah_tiba: 3, selesai: 4 };
const states = { selesai: 'selesai', sudahtiba: 'sudah_tiba', sedangantri: 'sedang_antre', sedangantre: 'sedang_antre' };
const sourcePositions = {
  bendahara: 'Bendahara', pengawas: 'Pengawas', dinaspendidikan: 'Dinas Pendidikan',
  kepalasekolah: 'Kepala Sekolah', fasilitator: 'Fasilitator', bbpmp: 'BB/BPMP',
};

export async function getSchoolArrivalStatuses(schools, venueId = null, query = q) {
  const corrections = eventId() === 5
    ? (await query("SELECT data->'arrival_corrections' AS corrections FROM assignment_roster WHERE id=1")).rows[0]?.corrections || {}
    : {};
  const { rows } = await query(`SELECT v.name AS venue, p.name, p.position, p.institution, p.arrival_status
    FROM venue_arrival_recap r JOIN venues v ON v.id=r.venue_id
    CROSS JOIN LATERAL jsonb_to_recordset(r.detail_rows)
      AS p(name text, position text, institution text, arrival_status text)
    WHERE ${eventVenueScope('v')} AND ($1::int IS NULL OR r.venue_id=$1) AND p.position IN ('Bendahara', 'Kepala Sekolah')`, [venueId]);
  const schoolIdentity = (venue, name) => JSON.stringify([arrivalVenueKey(venue), schoolKey(name)]);
  const schoolGroups=new Map(),exactSchoolGroups=new Map(),headGroups=new Map();
  for (const school of schools) {
    const headKey=JSON.stringify([schoolIdentity(school.venue,school.name),attendeeNameKey(schoolHeadOverride(school.npsn,school.head_name) || school.head_name)]);
    if (!headGroups.has(headKey)) headGroups.set(headKey,new Set());
    headGroups.get(headKey).add(String(school.npsn));
    for (const [groups,identity] of [[schoolGroups,schoolIdentity(school.venue,school.name)],
      [exactSchoolGroups,JSON.stringify([arrivalVenueKey(school.venue),key(school.name)])]]) {
      if (!groups.has(identity)) groups.set(identity,new Set());
      groups.get(identity).add(String(school.npsn));
    }
  }
  const bySchool = new Map();
  for (const row of rows) {
    if (!schoolKey(row.institution)) continue;
    const override = arrivalSchoolOverride(row);
    const identity = override ? JSON.stringify(['npsn', arrivalVenueKey(row.venue), override]) : schoolIdentity(row.venue, row.institution);
    if (!bySchool.has(identity)) bySchool.set(identity, new Map());
    const attendees = bySchool.get(identity);
    const name = attendeeNameKey(row.name);
    if (!name) continue;
    const previous = attendees.get(name);
    if (!previous || (priority[row.arrival_status] || 0) > (priority[previous.arrival_status] || 0)) {
      attendees.set(name, row);
    }
  }
  return schools.map(school => {
    const identity=schoolIdentity(school.venue,school.name);
    const shared=(schoolGroups.get(identity)?.size || 0)>1;
    const exactIdentity=JSON.stringify([arrivalVenueKey(school.venue),key(school.name)]);
    const exactUnique=exactSchoolGroups.get(exactIdentity)?.size===1;
    const headName = schoolHeadOverride(school.npsn, school.head_name) || school.head_name;
    const head = attendeeNameKey(headName);
    const uniqueHead=head && headGroups.get(JSON.stringify([identity,head]))?.size===1;
    const sourceEntries=[...(bySchool.get(identity) || [])].filter(([name,row])=>!shared
      || (exactUnique && key(row.institution)===key(school.name))
      || (uniqueHead && name===head));
    const attendees = new Map([
      ...sourceEntries,
      ...(bySchool.get(JSON.stringify(['npsn', arrivalVenueKey(school.venue), String(school.npsn)])) || []),
    ]);
    const correction = corrections[String(school.npsn)];
    if (correction && arrivalVenueKey(correction.venue) === arrivalVenueKey(school.venue)) {
      return {...school, head_name:correction.head_name || school.head_name,
        arrival_attendees:correction.attendees,
        arrival_status:correction.attendees.reduce((best,p)=>(priority[p.status] || 0)>(priority[best] || 0)?p.status:best,null)};
    }
    const isHead = (name, row) => row.position === 'Kepala Sekolah' || name === head;
    const canInferTreasurer = attendees.size === 2 && [...attendees].filter(([name, row]) => isHead(name, row)).length === 1;
    const fallbackRole = 'Perwakilan Sekolah';
    const arrival_attendees = [...attendees].map(([name, row]) => ({
      name: row.name,
      role: isHead(name, row) ? 'Kepala Sekolah' : canInferTreasurer ? 'Bendahara' : fallbackRole,
      status: row.arrival_status || 'belum_tercatat',
    }));
    const arrival_status = arrival_attendees.reduce((best, { status }) =>
      !best || (priority[status] || 0) > (priority[best] || 0) ? status : best, null);
    return { ...school, head_name: headName, arrival_status, arrival_attendees,
      arrival_identity_ambiguous:shared && !exactUnique };
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

export async function importArrivalRecap(rows, summary = null, { audit = false } = {}) {
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
  if (eventId() === 5) {
    for (const [hotel, rawRole, name, institution] of rows) {
      if (key(rawRole) !== 'sekolah' || !attendeeNameKey(name)) continue;
      const identity = schoolAttendanceKey(hotel, institution);
      if (!genericSchoolNames.has(identity)) genericSchoolNames.set(identity, new Set());
      genericSchoolNames.get(identity).add(attendeeNameKey(name));
    }
  }
  let unmatched = 0;
  const unmatchedGroups = new Map();
  function recordUnmatched({ venue, institution, rawRole }, reason) {
    unmatched++;
    if (!audit) return;
    const group = JSON.stringify([venue, key(institution), key(rawRole), reason]);
    const entry = unmatchedGroups.get(group) || {
      venue, instansi: institution || '(kosong)', peranExcel: rawRole, alasan: reason, baris: 0,
    };
    entry.baris++;
    unmatchedGroups.set(group, entry);
  }
  for (const [hotel, rawRole, name, institution, rawArrival, confirmation] of rows) {
    const venue = resolveVenue(hotel);
    if (!venue) throw new HttpError(400, `Venue di Excel tidak ditemukan di aplikasi: ${hotel || '(kosong)'}.`);
    if (!snapshots.has(venue.id)) snapshots.set(venue.id, { venue_id: venue.id, marks: {}, representatives: {}, detail_rows: [] });
    const snapshot = snapshots.get(venue.id);
    const arrivalKey = key(rawArrival);
    const confirmationKey = key(confirmation);
    const unconfirmed = confirmationKey === 'belumkonfirmasi' || (!confirmationKey && arrivalKey === 'belumkonfirmasi');
    const recorded = unconfirmed && people.some(p => p.has_attendance && p.venue_id === venue.id
      && roles[key(p.position)] === roles[key(rawRole)]
      && (key(p.name) === key(name) || (roles[key(rawRole)] === 'bendahara' && schoolKey(institution)
        && (p.institution || '').split(';').some(part => schoolKey(part) === schoolKey(institution)))));
    if (unconfirmed && !recorded) continue;
    const arrival = states[arrivalKey];
    const notArrived = arrivalKey === 'belumtiba' ||
      (confirmationKey === 'bersediahadir' && (!arrivalKey || arrivalKey === 'belumkonfirmasi'));
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
      arrival_status: arrival || (notArrived ? 'belum_tiba' : null),
    });
    const source = { venue: venue.name, institution, rawRole };
    if (!role && eventId() === 5 && key(rawRole) === 'sekolah') {
      recordUnmatched(source, 'Peran peserta sekolah belum dapat dipastikan');
      continue;
    }
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
      recordUnmatched(source, matches.length ? 'Lebih dari satu profil cocok' : 'Profil tidak ditemukan');
      continue;
    }
    if (eventId() === 5 && matches[0].has_attendance
      && attendeeNameKey(name) !== attendeeNameKey(matches[0].name)) {
      recordUnmatched(source, 'Nama berbeda pada profil yang sudah memiliki absensi; perlu konfirmasi identitas');
      continue;
    }
    proposals.push({ snapshot, person: matches[0], name, arrival, source });
  }
  const namesByProfile = new Map();
  for (const { person, name } of proposals) {
    if (!namesByProfile.has(person.id)) namesByProfile.set(person.id, new Set());
    namesByProfile.get(person.id).add(key(name));
  }
  for (const { snapshot, person, name, arrival, source } of proposals) {
    // Do not choose a representative when the source lists different attendees
    // against the same profile. These entries still need a manual check.
    if (namesByProfile.get(person.id).size !== 1) {
      recordUnmatched(source, 'Beberapa nama mengarah ke profil yang sama');
      continue;
    }
    const id = person.id;
    if (priority[arrival] > (priority[snapshot.marks[id]] || 0)) snapshot.marks[id] = arrival;
    if (key(name) && name.trim() !== '-' && attendeeNameKey(name) !== attendeeNameKey(person.name)) {
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
  if (audit) {
    return { unmatched, groups: [...unmatchedGroups.values()].sort((a, b) =>
      a.venue.localeCompare(b.venue, 'id') || a.instansi.localeCompare(b.instansi, 'id')) };
  }
  if (pks) {
    // Keep confirmed profile bindings through re-imports while that same source
    // participant remains in the same school and venue.
    const { rows: previous } = await q('SELECT venue_id,representatives FROM venue_arrival_recap');
    for (const snapshot of snapshotsToSave) {
      const bindings = previous.find(row => row.venue_id === snapshot.venue_id)?.representatives || {};
      for (const [id, representative] of Object.entries(bindings)) {
        if (representative.role !== 'Perwakilan Sekolah' || snapshot.representatives[id]) continue;
        const profile = people.find(p => String(p.id) === id && p.venue_id === snapshot.venue_id);
        if (!profile) continue;
        const entries = snapshot.detail_rows.filter(row => attendeeNameKey(row.name) === attendeeNameKey(representative.name)
          && schoolKey(row.institution) === schoolKey(profile.institution));
        if (entries.length !== 1) continue;
        snapshot.representatives[id] = { ...representative, name: entries[0].name };
        if (priority[entries[0].arrival_status]) snapshot.marks[id] = entries[0].arrival_status;
      }
    }
  }
  await q(`INSERT INTO venue_arrival_recap (venue_id,marks,detail_rows,source_summary,representatives)
    SELECT venue_id,marks,detail_rows,source_summary,representatives
    FROM jsonb_to_recordset($1::jsonb) AS v(venue_id int,marks jsonb,detail_rows jsonb,source_summary jsonb,representatives jsonb) ORDER BY venue_id
    ON CONFLICT (venue_id) DO UPDATE SET marks=EXCLUDED.marks, detail_rows=EXCLUDED.detail_rows, source_summary=EXCLUDED.source_summary, representatives=EXCLUDED.representatives, imported_at=now()`,
    [JSON.stringify(snapshotsToSave)]);
  const matched = snapshotsToSave.reduce((sum, row) => sum + Object.keys(row.marks).length, 0);
  return { imported: rows.length, matched, unmatched, venues: snapshotsToSave.length, warnings,
    representatives: snapshotsToSave.reduce((sum, snapshot) => sum + Object.keys(snapshot.representatives).length, 0) };
}

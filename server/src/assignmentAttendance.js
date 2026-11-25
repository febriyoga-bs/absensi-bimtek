import { q } from './db.js';
import { eventId } from './eventContext.js';
import { pksVerifierArrivalSql } from './pksVerifierArrival.js';
import { HttpError } from './util.js';
import { reportingCheckInDates, reportingDates } from './reportingDays.js';

const positions = {
  schools: '^(bendahara|pengawas|kepala sekolah)$',
  supervisors: '^pengawas$',
  facilitators: '^(verifikator|fasil(itator)?)($|[[:space:]])',
  coordinators: '^(koor(dinator)?)($|[[:space:]])',
};
const nameKey = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolsOf = (person) => String(person.npsn || '').split(';').map((value) => value.trim());

export async function getReportingSchoolAttendance(npsn, user) {
  if (!/^\d{8}$/.test(npsn)) throw new HttpError(400, 'NPSN sekolah tidak valid.');
  const { rows: [school] } = await q(`SELECT s.venue,s.lo FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text,venue text,lo text)
    WHERE r.id=1 AND s.npsn=$1`, [npsn]);
  if (!school) throw new HttpError(404, 'Sekolah tidak ditemukan di pemetaan kegiatan ini.');
  return getAssignmentAttendance('schools', school.venue, school.lo, npsn, user);
}

export async function getAssignmentAttendance(type, venue, lo, npsn = null, user) {
  if (!Object.hasOwn(positions, type) || !venue || !lo) throw new HttpError(400, 'Jenis atau penugasan rekap tidak valid.');
  const { rows: [assignment] } = await q(
    `SELECT v.id AS venue_id, l.account_id, ARRAY(
       SELECT entry FROM jsonb_array_elements(r.data->$1::text) entry
       WHERE entry->>'venue'=$2 AND entry->>'lo'=$3 AND ($4::text IS NULL OR entry->>'npsn'=$4)
     ) AS entries
     FROM assignment_roster r
     CROSS JOIN LATERAL jsonb_to_recordset(r.data->'lo') AS l(name text, venue text, venue_id int, account_id int)
     LEFT JOIN venues v ON v.id=l.venue_id OR (l.venue_id IS NULL AND v.name=l.venue)
     WHERE r.id=1 AND l.venue=$2 AND l.name=$3`, [type, venue, lo, npsn]);
  if (!assignment) throw new HttpError(404, 'Penugasan LO tidak ditemukan.');
  const { venue_id: venueId, account_id: accountId, entries } = assignment;
  const canSeeContact = user?.role === 'admin' || (user?.lo === accountId && user?.venue === venueId);
  const schoolIds = type === 'schools' ? entries.map((row) => row.npsn) : null;
  const [{ rows: profiles }, { rows: source }] = await Promise.all([
    q(`SELECT p.name, p.position, p.npsn, p.phone, a.status, ${pksVerifierArrivalSql('p.position', 'arrival.marks->>p.id::text', eventId())} AS arrival_status,
         ${reportingCheckInDates('p.id', '$1', '$4')} AS check_in_dates
       FROM people p LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=$1 AND p.venue_id=$1
       LEFT JOIN LATERAL (
         SELECT a.status FROM attendance a JOIN sessions s ON s.id=a.session_id AND NOT s.is_test
         WHERE a.person_id=p.id AND a.venue_id=$1
         ORDER BY CASE a.status WHEN 'valid' THEN 0 WHEN 'review' THEN 1 WHEN 'berhalangan' THEN 2 ELSE 3 END
         LIMIT 1
       ) a ON true
       WHERE p.archived_at IS NULL AND lower(trim(p.position)) ~ $2
         AND (p.venue_id=$1 OR (p.venue_id IS NULL AND a.status IS NOT NULL))
         AND ($3::text[] IS NULL OR string_to_array(replace(p.npsn,' ',''),';') && $3)`,
    [venueId, positions[type], schoolIds, reportingDates]),
    schoolIds?.length ? q(`SELECT p.name,p.position,p.npsn FROM assignment_roster r
      CROSS JOIN LATERAL jsonb_to_recordset(r.data->'participants') AS p(name text,position text,npsn text,venue text)
      WHERE r.id=1 AND p.venue=$1 AND string_to_array(replace(p.npsn,' ',''),';') && $2::text[]`, [venue, schoolIds])
      : { rows: [] },
  ]);

  return entries.map((entry) => {
    if (type === 'schools') {
      const expected = source.filter((person) => schoolsOf(person).includes(entry.npsn));
      const registered = profiles.filter((person) => schoolsOf(person).includes(entry.npsn));
      const people = expected.length ? expected : registered;
      return { ...entry, people: people.map((person) => {
        const matches = registered.filter((p) => p.position.toLowerCase().trim() === person.position.toLowerCase().trim()
          && nameKey(p.name) === nameKey(person.name));
        const match = matches.length === 1 ? matches[0] : null;
        return { name: person.name, position: person.position, registered: !!match, status: match?.status ?? null,
          arrival_status: match?.arrival_status ?? null, check_in_dates: match?.check_in_dates || [],
          phone: canSeeContact ? match?.phone : undefined };
      }) };
    }
    const matches = profiles.filter((p) => nameKey(p.name) === nameKey(entry.name));
    const match = matches.length === 1 ? matches[0] : null;
    return { ...entry, people: [{ name: entry.name, registered: !!match, status: match?.status ?? null,
      arrival_status: match?.arrival_status ?? null, check_in_dates: match?.check_in_dates || [],
      phone: canSeeContact ? match?.phone : undefined }] };
  });
}

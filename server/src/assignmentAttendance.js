import { q } from './db.js';
import { HttpError } from './util.js';

const positions = {
  schools: '^(bendahara|pengawas)$',
  supervisors: '^pengawas$',
  facilitators: '^fasil(itator)?($|[[:space:]])',
  coordinators: '^(koor(dinator)?)($|[[:space:]])',
};
const nameKey = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolsOf = (person) => String(person.npsn || '').split(';').map((value) => value.trim());

export async function getAssignmentAttendance(type, venue, lo) {
  if (!Object.hasOwn(positions, type) || !venue || !lo) throw new HttpError(400, 'Jenis atau penugasan rekap tidak valid.');
  const { rows: [assignment] } = await q(
    `SELECT v.id AS venue_id, ARRAY(
       SELECT entry FROM jsonb_array_elements(r.data->$1::text) entry
       WHERE entry->>'venue'=$2 AND entry->>'lo'=$3
     ) AS entries
     FROM assignment_roster r
     CROSS JOIN LATERAL jsonb_to_recordset(r.data->'lo') AS l(name text, venue text, venue_id int)
     LEFT JOIN venues v ON v.id=l.venue_id OR (l.venue_id IS NULL AND v.name=l.venue)
     WHERE r.id=1 AND l.venue=$2 AND l.name=$3`, [type, venue, lo]);
  if (!assignment) throw new HttpError(404, 'Penugasan LO tidak ditemukan.');
  const { venue_id: venueId, entries } = assignment;
  const schoolIds = type === 'schools' ? entries.map((row) => row.npsn) : null;
  const [{ rows: profiles }, { rows: source }] = await Promise.all([
    q(`SELECT p.name, p.position, p.npsn, a.status
       FROM people p LEFT JOIN LATERAL (
         SELECT status FROM attendance a WHERE a.person_id=p.id AND a.venue_id=$1
         ORDER BY CASE status WHEN 'valid' THEN 0 WHEN 'review' THEN 1 WHEN 'berhalangan' THEN 2 ELSE 3 END
         LIMIT 1
       ) a ON true
       WHERE p.archived_at IS NULL AND lower(trim(p.position)) ~ $2
         AND (p.venue_id=$1 OR (p.venue_id IS NULL AND a.status IS NOT NULL))
         AND ($3::text[] IS NULL OR string_to_array(replace(p.npsn,' ',''),';') && $3)`,
    [venueId, positions[type], schoolIds]),
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
        return { name: person.name, position: person.position, registered: matches.length === 1, status: matches.length === 1 ? matches[0].status : null };
      }) };
    }
    const matches = profiles.filter((p) => nameKey(p.name) === nameKey(entry.name));
    return { ...entry, people: [{ name: entry.name, registered: matches.length === 1, status: matches.length === 1 ? matches[0].status : null }] };
  });
}

import { q } from './db.js';
import { HttpError } from './util.js';

const emptyCount = () => ({ total: 0, registered: 0, attended: 0 });
const nameKey = (name) => String(name || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const participantPositions = {
  bendahara: 'bendahara', pengawas: 'pengawas', dinas: 'dinas pendidikan', bpmp: 'bb/bpmp',
};

function assignmentProfiles(rows, profiles, venueIds, venueId) {
  const byName = new Map();
  for (const profile of profiles) {
    const key = nameKey(profile.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(profile);
  }

  const assignments = new Map();
  const venuesByPerson = new Map();
  for (const row of rows) {
    const id = row.venue_id ?? venueIds.get(row.venue);
    const key = nameKey(row.name);
    if (id == null || !key) continue;
    const names = [...new Set([key, nameKey(row.account_name)].filter(Boolean))];
    assignments.set(`${id}:${key}`, { id, names, name: row.name });
    for (const name of names) {
      if (!venuesByPerson.has(name)) venuesByPerson.set(name, new Set());
      venuesByPerson.get(name).add(id);
    }
  }

  const counted = new Set();
  const result = [];
  for (const { id, names, name } of assignments.values()) {
    if (venueId != null && venueId !== id) continue;
    const candidates = new Set(names.flatMap((name) => (byName.get(name) || []).filter((p) =>
      p.venue_id === id || (p.venue_id == null && venuesByPerson.get(name).size === 1))));
    const assigned = [...candidates].filter((p) => p.venue_id === id);
    const matches = assigned.length ? assigned : [...candidates];
    const match = matches.length === 1 ? matches[0] : null;
    const profileKey = match && `${id}:${match.id}`;
    const registered = !!match && !counted.has(profileKey);
    if (registered) counted.add(profileKey);
    result.push({ id, name, registered, status: registered ? (match.status_by_venue[id] ?? null) : null,
      arrival_status: registered && match.venue_id === id ? match.arrival_status : null });
  }
  return result;
}

const loadRoster = () => q(`SELECT
  (SELECT jsonb_agg(f) FROM jsonb_to_recordset(data->'facilitators') AS f(name text, venue text)) AS facilitators,
  (SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('account_name', a.name))
   FROM jsonb_to_recordset(data->'lo') AS l(name text, venue text, venue_id int, account_id int)
   LEFT JOIN lo_accounts a ON a.id=l.account_id) AS lo
  FROM assignment_roster WHERE id=1`);

const statusOrder = "CASE a.status WHEN 'valid' THEN 0 WHEN 'review' THEN 1 WHEN 'berhalangan' THEN 2 ELSE 3 END";

const loadProfiles = (venueId, day) => q(`WITH profiles AS (
  SELECT id, name, venue_id, CASE
    WHEN lower(trim(position)) LIKE 'fasil%' THEN 'fasil'
    WHEN role='panitia' AND (lower(trim(position)) ~ '^lo($|[[:space:]])'
      OR lower(trim(position))='liaison officer') THEN 'lo'
  END AS category FROM people WHERE archived_at IS NULL
)
SELECT p.id, p.name, p.venue_id, p.category, arrival.marks->>p.id::text AS arrival_status, (
  SELECT COALESCE(jsonb_object_agg(t.venue_id,t.status),'{}')
  FROM (
    SELECT DISTINCT ON (a.venue_id) a.venue_id, a.status FROM attendance a JOIN sessions s ON s.id=a.session_id AND NOT s.is_test
    WHERE a.person_id=p.id AND a.venue_id IS NOT NULL AND ($1::int IS NULL OR a.venue_id=$1)
      AND ($2::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$2)
    ORDER BY a.venue_id, ${statusOrder}
  ) t
) AS status_by_venue FROM profiles p LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id
WHERE p.category IS NOT NULL`, [venueId, day]);

function rosterVenueIds(venues, roster) {
  const ids = new Map(venues.map(({ id, name }) => [name, id]));
  for (const lo of roster?.lo || []) {
    if (lo.venue_id != null) ids.set(lo.venue, lo.venue_id);
  }
  return ids;
}

function groupProfiles(roster, profiles, group, ids, venueId) {
  const entries = group === 'fasil' ? roster?.facilitators : roster?.lo;
  return assignmentProfiles(entries || [], profiles.filter((p) => p.category === group), ids, venueId);
}

export async function getVenueAttendanceDetails(venueId, group, day = null) {
  if (Object.hasOwn(participantPositions, group)) {
    const { rows } = await q(`SELECT p.name, p.institution, p.ruangan AS room, p.npsn, a.status,
        arrival.marks->>p.id::text AS arrival_status
      FROM people p LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id
      LEFT JOIN LATERAL (
        SELECT a.status FROM attendance a JOIN sessions s ON s.id=a.session_id AND NOT s.is_test
        WHERE a.person_id=p.id AND a.venue_id=p.venue_id
          AND ($3::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3)
        ORDER BY ${statusOrder} LIMIT 1
      ) a ON true
      WHERE p.role='peserta' AND p.archived_at IS NULL AND p.venue_id=$1 AND lower(trim(p.position))=$2
      ORDER BY p.name, p.id`, [venueId, participantPositions[group], day]);
    return rows.map(({ status, arrival_status, ...entry }) => ({
      ...entry, people: [{ name: entry.name, registered: true, status, arrival_status }],
    }));
  }
  if (group !== 'lo' && group !== 'fasil') throw new HttpError(400, 'Kategori kehadiran tidak valid.');
  const [{ rows: venues }, { rows: [roster] }, { rows: profiles }] = await Promise.all([
    q('SELECT id, name FROM venues'), loadRoster(), loadProfiles(venueId, day),
  ]);
  return groupProfiles(roster, profiles, group, rosterVenueIds(venues, roster), venueId)
    .map(({ name, registered, status, arrival_status }) => ({ name, people: [{ name, registered, status, arrival_status }] }));
}

export async function getVenueAttendance(venueId, day = null) {
  const [{ rows: venues }, { rows: [roster] }, { rows: profiles }] = await Promise.all([
    q(`WITH counts AS (
      SELECT p.venue_id, lower(trim(p.position)) AS category, count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM attendance a JOIN sessions s ON s.id=a.session_id AND NOT s.is_test
          WHERE a.person_id=p.id AND a.venue_id=p.venue_id AND a.status IN ('valid','review')
            AND ($3::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3)
        ))::int AS attended
      FROM people p
      WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position))=ANY($2::text[])
        AND p.venue_id IS NOT NULL AND ($1::int IS NULL OR p.venue_id=$1)
      GROUP BY p.venue_id, lower(trim(p.position))
    )
    SELECT v.id, v.name, COALESCE(jsonb_object_agg(c.category, jsonb_build_object(
      'total', c.total, 'registered', c.total, 'attended', c.attended)) FILTER (WHERE c.category IS NOT NULL), '{}') AS counts
    FROM venues v LEFT JOIN counts c ON c.venue_id=v.id GROUP BY v.id, v.name ORDER BY v.name`, [venueId, Object.values(participantPositions), day]),
    loadRoster(),
    loadProfiles(venueId, day),
  ]);

  const cards = new Map(venues.filter(({ id }) => venueId == null || id === venueId).map(({ id, name, counts }) => [id, {
    id, name, fasil: emptyCount(), lo: emptyCount(),
    ...Object.fromEntries(Object.entries(participantPositions).map(([key, position]) => [key, counts[position] ?? emptyCount()])),
  }]));
  const ids = rosterVenueIds(venues, roster);
  for (const group of ['fasil', 'lo']) {
    for (const person of groupProfiles(roster, profiles, group, ids, venueId)) {
      const count = cards.get(person.id)?.[group];
      if (!count) continue;
      count.total++;
      if (person.registered) count.registered++;
      if (person.status === 'valid' || person.status === 'review') count.attended++;
    }
  }
  return [...cards.values()];
}

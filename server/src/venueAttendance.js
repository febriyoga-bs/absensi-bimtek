import { q } from './db.js';

const emptyCount = () => ({ total: 0, registered: 0, attended: 0 });
const nameKey = (name) => String(name || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function countAssignments(cards, rows, profiles, group, venueIds) {
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
    assignments.set(`${id}:${key}`, { id, names });
    for (const name of names) {
      if (!venuesByPerson.has(name)) venuesByPerson.set(name, new Set());
      venuesByPerson.get(name).add(id);
    }
  }

  const counted = new Set();
  for (const { id, names } of assignments.values()) {
    const count = cards.get(id)?.[group];
    if (!count) continue;
    count.total++;
    const candidates = new Set(names.flatMap((name) => (byName.get(name) || []).filter((p) =>
      p.venue_id === id || (p.venue_id == null && venuesByPerson.get(name).size === 1))));
    const assigned = [...candidates].filter((p) => p.venue_id === id);
    const matches = assigned.length ? assigned : [...candidates];
    if (matches.length !== 1) continue;
    const match = matches[0];
    const profileKey = `${id}:${match.id}`;
    if (counted.has(profileKey)) continue;
    counted.add(profileKey);
    count.registered++;
    if (match.attended_venues.includes(id)) count.attended++;
  }
}

export async function getVenueAttendance(venueId) {
  const [{ rows: venues }, { rows: [roster] }, { rows: profiles }] = await Promise.all([
    q(`WITH counts AS (
      SELECT p.venue_id, lower(trim(p.position)) AS category, count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM attendance a WHERE a.person_id=p.id AND a.venue_id=p.venue_id AND a.status IN ('valid','review')
        ))::int AS attended
      FROM people p
      WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position)) IN ('bendahara','pengawas')
        AND p.venue_id IS NOT NULL AND ($1::int IS NULL OR p.venue_id=$1)
      GROUP BY p.venue_id, lower(trim(p.position))
    )
    SELECT v.id, v.name, COALESCE(jsonb_object_agg(c.category, jsonb_build_object(
      'total', c.total, 'registered', c.total, 'attended', c.attended)) FILTER (WHERE c.category IS NOT NULL), '{}') AS counts
    FROM venues v LEFT JOIN counts c ON c.venue_id=v.id GROUP BY v.id ORDER BY v.name`, [venueId]),
    q(`SELECT
      (SELECT jsonb_agg(f) FROM jsonb_to_recordset(data->'facilitators') AS f(name text, venue text)) AS facilitators,
      (SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('account_name', a.name))
       FROM jsonb_to_recordset(data->'lo') AS l(name text, venue text, venue_id int, account_id int)
       LEFT JOIN lo_accounts a ON a.id=l.account_id) AS lo
     FROM assignment_roster WHERE id=1`),
    q(`WITH profiles AS (
      SELECT id, name, venue_id, CASE
        WHEN lower(trim(position)) LIKE 'fasil%' THEN 'fasil'
        WHEN role='panitia' AND (lower(trim(position)) ~ '^lo($|[[:space:]])'
          OR lower(trim(position))='liaison officer') THEN 'lo'
      END AS category
      FROM people WHERE archived_at IS NULL
    )
    SELECT p.id, p.name, p.venue_id, p.category, ARRAY(
      SELECT DISTINCT a.venue_id FROM attendance a
      WHERE a.person_id=p.id AND a.status IN ('valid','review')
        AND a.venue_id IS NOT NULL AND ($1::int IS NULL OR a.venue_id=$1)
    ) AS attended_venues
    FROM profiles p WHERE p.category IS NOT NULL`, [venueId]),
  ]);

  const cards = new Map(venues.filter(({ id }) => venueId == null || id === venueId).map(({ id, name, counts }) => [id, {
    id, name, bendahara: emptyCount(), pengawas: emptyCount(), fasil: emptyCount(), lo: emptyCount(), ...counts,
  }]));
  const venueIds = new Map(venues.map(({ id, name }) => [name, id]));
  for (const lo of roster?.lo || []) {
    if (lo.venue_id != null) venueIds.set(lo.venue, lo.venue_id);
  }
  countAssignments(cards, roster?.facilitators || [], profiles.filter((p) => p.category === 'fasil'), 'fasil', venueIds);
  countAssignments(cards, roster?.lo || [], profiles.filter((p) => p.category === 'lo'), 'lo', venueIds);
  return [...cards.values()];
}

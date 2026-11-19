import { q } from './db.js';
import { HttpError } from './util.js';
import { eventVenueScope } from './eventVenues.js';
import { sourceAttendance } from './sourceAttendance.js';

const emptyCount = () => ({ total: 0, registered: 0, attended: 0, recorded: 0 });
const nameKey = (name) => String(name || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const participantPositions = {
  bendahara: 'bendahara', pengawas: 'pengawas', dinas: 'dinas pendidikan', bpmp: 'bb/bpmp',
};

function assignmentProfiles(rows, profiles, venueIds, venueId) {
  const byName = new Map();
  const byCode = new Map(profiles.filter((profile)=>profile.code).map((profile)=>[profile.code.toLowerCase(),profile]));
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
    assignments.set(`${id}:${key}`, { id, names, name: row.name,username:row.account_username });
    for (const name of names) {
      if (!venuesByPerson.has(name)) venuesByPerson.set(name, new Set());
      venuesByPerson.get(name).add(id);
    }
  }

  const counted = new Set();
  const result = [];
  for (const { id, names, name,username } of assignments.values()) {
    if (venueId != null && venueId !== id) continue;
    const coded = username && byCode.get(username.toLowerCase());
    const candidates = coded ? new Set(coded.venue_id===id ? [coded] : [])
      : new Set(names.flatMap((name) => (byName.get(name) || []).filter((p) =>
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
  (SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('account_name', a.name,'account_username',a.username))
   FROM jsonb_to_recordset(data->'lo') AS l(name text, venue text, venue_id int, account_id int)
   LEFT JOIN lo_accounts a ON a.id=l.account_id) AS lo
  FROM assignment_roster WHERE id=1`);

const statusOrder = "CASE a.status WHEN 'valid' THEN 0 WHEN 'review' THEN 1 WHEN 'berhalangan' THEN 2 ELSE 3 END";

const loadProfiles = (venueId, day, testSession = null) => q(`WITH profiles AS (
  SELECT id, code, name, venue_id, institution, position, npsn, ruangan AS room, CASE
    WHEN lower(trim(position)) LIKE 'fasil%' THEN 'fasil'
    WHEN role='panitia' AND (lower(trim(position)) ~ '^lo($|[[:space:]])'
      OR lower(trim(position))='liaison officer') THEN 'lo'
    WHEN role='peserta' AND lower(trim(position)) IN ('bendahara','pengawas','dinas pendidikan') THEN 'source_participant'
  END AS category FROM people WHERE archived_at IS NULL
)
SELECT p.id, p.code, p.name, p.venue_id, p.category, p.institution, p.position, p.npsn, p.room, arrival.marks->>p.id::text AS arrival_status, (
  SELECT COALESCE(jsonb_object_agg(t.venue_id,t.status),'{}')
  FROM (
    SELECT DISTINCT ON (a.venue_id) a.venue_id, a.status FROM attendance a JOIN sessions s ON s.id=a.session_id
    WHERE a.person_id=p.id AND a.venue_id IS NOT NULL AND ($1::int IS NULL OR a.venue_id=$1)
      AND ($2::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$2)
      AND (CASE WHEN $3::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$3 END)
    ORDER BY a.venue_id, ${statusOrder}
  ) t
) AS status_by_venue FROM profiles p LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id
WHERE p.category IS NOT NULL`, [venueId, day, testSession]);

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

const loadArrivalSources = venueId => q(`SELECT r.venue_id,r.source_summary,r.detail_rows FROM venue_arrival_recap r
  JOIN venues v ON v.id=r.venue_id WHERE ($1::int IS NULL OR r.venue_id=$1) AND ${eventVenueScope('v')}`, [venueId]);

const recordGroup = p => {
  const position = String(p.position || '').trim().toLowerCase();
  if (/^fasil/.test(position)) return 'fasil';
  if (/^lo($|\s)|^liaison officer$/.test(position)) return 'lo';
  if (p.role === 'peserta') return Object.entries(participantPositions).find(([, value]) => value === position)?.[0] || 'other';
  return 'other';
};
const loadSessionRecords = (venueId, day, testSession) => q(`SELECT a.id,a.person_id,a.venue_id,a.status,
  CASE WHEN lower(trim(p.position)) IN ('bendahara','pengawas','dinas pendidikan') AND arrival.representatives->p.id::text->>'name' IS NOT NULL
    THEN arrival.representatives->p.id::text->>'name'
  WHEN lower(trim(p.name)) IN ('(belum ada di biodata)','belum ada di biodata','(belum ada)','-','') THEN COALESCE((
    SELECT min(d->>'name') FROM venue_arrival_recap r CROSS JOIN LATERAL jsonb_array_elements(r.detail_rows) d
    WHERE r.venue_id=a.venue_id AND lower(trim(d->>'position'))=lower(trim(p.position))
      AND lower(trim(d->>'institution'))=lower(trim(p.institution))
      AND trim(d->>'name') NOT IN ('','-') AND lower(d->>'name') NOT LIKE '%belum ada%'
    HAVING count(DISTINCT lower(trim(d->>'name')))=1
  ),p.name) ELSE p.name END AS name,p.name AS original_name,p.institution,p.npsn,p.ruangan AS room,p.role,p.position
  FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN people p ON p.id=a.person_id
  LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=a.venue_id
  WHERE ($1::int IS NULL OR a.venue_id=$1) AND a.status IN ('valid','review','ditolak','berhalangan')
    AND ($2::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$2)
    AND (CASE WHEN $3::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$3 END)
  ORDER BY p.name,a.id`, [venueId,day,testSession]);

export async function getVenueAttendanceDetails(venueId, group, day = null, testSession = null) {
  const [entries, { rows: records }] = await Promise.all([
    group === 'other' ? Promise.resolve([]) : loadVenueAttendanceDetails(venueId, group, day, testSession),
    loadSessionRecords(venueId, day, testSession),
  ]);
  const actual = records.filter(p => recordGroup(p) === group);
  const recordedIds = new Set(actual.map(p => p.person_id));
  const recordedNames = new Set(actual.flatMap(p => [nameKey(p.name), nameKey(p.original_name)]));
  const recordedSchools = new Set(actual.flatMap(p => String(p.npsn || '').split(';').map(v => v.trim()).filter(Boolean)));
  const remaining = entries.filter(e => !recordedIds.has(e.source_profile_id) && !recordedNames.has(nameKey(e.name)) && !(group === 'bendahara' && String(e.npsn || '').split(';').some(id => recordedSchools.has(id.trim()))));
  entries.splice(0, entries.length, ...actual.map(p => ({ name:p.name,original_name:p.original_name !== p.name ? p.original_name : null,institution:p.institution,npsn:p.npsn,room:p.room,
    people:[{name:p.name,registered:true,status:p.status}] })), ...remaining.map(e => ({...e,people:e.people.map(p=>({...p,status:null}))})));

  if (!Object.hasOwn(participantPositions, group)) return entries;
  const { rows: assignments } = await q(`SELECT DISTINCT l.name AS lo_name,m.name,m.npsn
    FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_each(r.data->'attendance_assignments') mapping
    JOIN lo_accounts l ON mapping.key=l.id::text AND l.active AND l.venue_id=$1
    CROSS JOIN LATERAL jsonb_to_recordset(mapping.value)
      AS m(name text,position text,npsn text,venue_id int)
    WHERE r.id=1 AND m.venue_id=$1 AND lower(trim(m.position))=$2
    UNION
    SELECT l.name,NULL,NULL FROM lo_accounts l
    WHERE l.active AND l.venue_id=$1 AND $2 IN ('dinas pendidikan','bb/bpmp')`,
  [venueId, participantPositions[group]]);
  const { rows: schoolAssignments } = group === 'bendahara' ? await q(`
    SELECT s.npsn,s.name AS institution,l.name AS lo_name
    FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text,name text,venue text,lo text)
    JOIN venues v ON v.id=$1 AND v.name=s.venue
    JOIN lo_accounts l ON l.venue_id=v.id AND l.active
      AND (lower(trim(l.name))=lower(trim(s.lo)) OR EXISTS (
        SELECT 1 FROM jsonb_to_recordset(r.data->'lo') AS owner(name text,account_id int)
        WHERE owner.account_id=l.id AND lower(trim(owner.name))=lower(trim(s.lo))))
    WHERE r.id=1`, [venueId]) : { rows: [] };
  return entries.map(entry => {
    const schools = String(entry.npsn || '').split(';').map(value => value.trim()).filter(Boolean);
    const assigned = assignments.filter(assignment => {
      if (!assignment.name) return true;
      const assignedSchools = String(assignment.npsn || '').split(';').map(value => value.trim()).filter(Boolean);
      const sameSchool = schools.some(id => assignedSchools.includes(id));
      if (group === 'bendahara' && sameSchool) return true;
      return nameKey(assignment.name) === nameKey(entry.name)
        && (!schools.length || !assignedSchools.length || sameSchool);
    });
    const schoolOwners = schoolAssignments.filter(school => schools.length
      ? schools.includes(school.npsn)
      : nameKey(school.institution) && nameKey(school.institution) === nameKey(entry.institution));
    return { ...entry, assigned_los: [...new Set([...assigned, ...schoolOwners].map(assignment => assignment.lo_name))] };
  });
}

async function loadVenueAttendanceDetails(venueId, group, day = null, testSession = null) {
  if (Object.hasOwn(participantPositions, group)) {
    if (group !== 'bpmp') {
      const [{ rows: [source] }, { rows: profiles }] = await Promise.all([
        loadArrivalSources(venueId), loadProfiles(venueId, day, testSession),
      ]);
      if (source?.source_summary?.some(row => row.position.toLowerCase() === participantPositions[group])) {
        return sourceAttendance(source,profiles,participantPositions[group]).details;
      }
    }
    const { rows } = await q(`SELECT p.id AS source_profile_id,p.name, p.institution, p.ruangan AS room, p.npsn, a.status,
        arrival.marks->>p.id::text AS arrival_status
      FROM people p LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id
      LEFT JOIN LATERAL (
        SELECT a.status FROM attendance a JOIN sessions s ON s.id=a.session_id
        WHERE a.person_id=p.id AND a.venue_id=p.venue_id
          AND ($3::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3)
          AND (CASE WHEN $4::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$4 END)
        ORDER BY ${statusOrder} LIMIT 1
      ) a ON true
      WHERE p.role='peserta' AND p.archived_at IS NULL AND p.venue_id=$1 AND lower(trim(p.position))=$2
      ORDER BY p.name, p.id`, [venueId, participantPositions[group], day, testSession]);
    return rows.map(({ status, arrival_status, ...entry }) => ({
      ...entry, people: [{ name: entry.name, registered: true, status, arrival_status }],
    }));
  }
  if (group !== 'lo' && group !== 'fasil') throw new HttpError(400, 'Kategori kehadiran tidak valid.');
  const [{ rows: venues }, { rows: [roster] }, { rows: profiles }] = await Promise.all([
    q(`SELECT v.id, v.name FROM venues v WHERE ${eventVenueScope('v')}`), loadRoster(), loadProfiles(venueId, day, testSession),
  ]);
  return groupProfiles(roster, profiles, group, rosterVenueIds(venues, roster), venueId)
    .map(({ name, registered, status, arrival_status }) => ({ name, people: [{ name, registered, status, arrival_status }] }));
}

export async function getVenueAttendance(venueId, day = null, testSession = null) {
  const [{ rows: venues }, { rows: [roster] }, { rows: profiles }, { rows: sources }] = await Promise.all([
    q(`WITH counts AS (
      SELECT p.venue_id, lower(trim(p.position)) AS category, count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM attendance a JOIN sessions s ON s.id=a.session_id
          WHERE a.person_id=p.id AND a.venue_id=p.venue_id AND a.status IN ('valid','review')
            AND ($3::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3)
            AND (CASE WHEN $4::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$4 END)
        ))::int AS attended,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM attendance a JOIN sessions s ON s.id=a.session_id
          WHERE a.person_id=p.id AND a.venue_id=p.venue_id AND a.status IN ('valid','review','berhalangan')
            AND ($3::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3)
            AND (CASE WHEN $4::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$4 END)
        ))::int AS recorded
      FROM people p
      WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position))=ANY($2::text[])
        AND p.venue_id IS NOT NULL AND ($1::int IS NULL OR p.venue_id=$1)
      GROUP BY p.venue_id, lower(trim(p.position))
    )
    SELECT v.id, v.name, COALESCE(jsonb_object_agg(c.category, jsonb_build_object(
      'total', c.total, 'registered', c.total, 'attended', c.attended, 'recorded', c.recorded)) FILTER (WHERE c.category IS NOT NULL), '{}') AS counts
    FROM venues v LEFT JOIN counts c ON c.venue_id=v.id WHERE ${eventVenueScope('v')}
    GROUP BY v.id, v.name ORDER BY v.name`, [venueId, Object.values(participantPositions), day, testSession]),
    loadRoster(),
    loadProfiles(venueId, day, testSession),
    loadArrivalSources(venueId),
  ]);

  const cards = new Map(venues.filter(({ id }) => venueId == null || id === venueId).map(({ id, name, counts }) => [id, {
    id, name, fasil: emptyCount(), lo: emptyCount(),
    ...Object.fromEntries(Object.entries(participantPositions).map(([key, position]) => [key, counts[position] ?? emptyCount()])),
  }]));
  const ids = rosterVenueIds(venues, roster);
  for (const source of sources) {
    const card = cards.get(source.venue_id); if (!card) continue;
    for (const group of ['bendahara','pengawas','dinas']) {
      const result = sourceAttendance(source,profiles,participantPositions[group]);
      if (result) card[group] = result.count;
    }
  }
  for (const group of ['fasil', 'lo']) {
    for (const person of groupProfiles(roster, profiles, group, ids, venueId)) {
      const count = cards.get(person.id)?.[group];
      if (!count) continue;
      count.total++;
      if (person.registered) count.registered++;
      if (['valid', 'review', 'berhalangan'].includes(person.status)) count.recorded++;
      if (person.status === 'valid' || person.status === 'review') count.attended++;
    }
  }
  const { rows: records } = await loadSessionRecords(venueId, day, testSession);
  for (const card of cards.values()) {
    card.other = emptyCount();
    for (const group of [...Object.keys(participantPositions), 'fasil', 'lo']) card[group].recorded = 0;
  }
  for (const record of records) {
    const card = cards.get(record.venue_id); if (!card) continue;
    const group = recordGroup(record);
    card[group].recorded++;
    if (group === 'other') card.other.total++;
  }
  return [...cards.values()];
}

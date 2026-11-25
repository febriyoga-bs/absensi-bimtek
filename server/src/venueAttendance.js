import { eventId } from './eventContext.js';
import { schoolIdentity, similarSchool } from './schoolIdentity.js';
import { q } from './db.js';
import { HttpError } from './util.js';
import { eventVenueScope } from './eventVenues.js';
import { sourceAttendance } from './sourceAttendance.js';
import { getSchoolArrivalStatuses, arrivalVenueKey } from './arrivalRecap.js';
import { representativeMatcher, representativeAttendance } from './representativeRecords.js';

const emptyCount = () => ({ total: 0, registered: 0, attended: 0, recorded: 0 });
const nameKey = (name) => String(name || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const participantPositions = {
  bendahara: 'bendahara', get pengawas() { return eventId() === 5 ? 'kepala sekolah' : 'pengawas'; },
  dinas: 'dinas pendidikan', bpmp: 'bb/bpmp',
};

function schoolRepresentatives(schools, venue) {
  const seen = new Set();
  return schools.filter(s => arrivalVenueKey(s.venue) === arrivalVenueKey(venue)).flatMap(s =>
    (s.arrival_attendees || []).filter(p => !['Kepala Sekolah', 'Bendahara'].includes(p.role)).map(p => ({
      name: p.name, institution: s.name, npsn: s.npsn,
      people: [{ name: p.name, registered: false, status: null, arrival_status: p.status }],
    }))).filter(p => {
      const identity = `${p.npsn || nameKey(p.institution)}:${nameKey(p.name)}`;
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
}

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
  data->'schools' AS schools,
  (SELECT jsonb_agg(f) FROM jsonb_to_recordset(data->'facilitators') AS f(name text, venue text)) AS facilitators,
  (SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('account_name', a.name,'account_username',a.username))
   FROM jsonb_to_recordset(data->'lo') AS l(name text, venue text, venue_id int, account_id int)
   LEFT JOIN lo_accounts a ON a.id=l.account_id) AS lo
  FROM assignment_roster WHERE id=1`);

const statusOrder = "CASE a.status WHEN 'valid' THEN 0 WHEN 'review' THEN 1 WHEN 'berhalangan' THEN 2 ELSE 3 END";

const loadProfiles = (venueId, day, testSession = null, includeArrival = true) => q(`WITH profiles AS (
  SELECT id, code, name, venue_id, institution, position, npsn, ruangan AS room, CASE
    WHEN (lower(trim(position)) LIKE 'fasil%' OR lower(trim(position))='verifikator') THEN 'fasil'
    WHEN role='panitia' AND (lower(trim(position)) ~ '^lo($|[[:space:]])'
      OR lower(trim(position))='liaison officer') THEN 'lo'
    WHEN role='peserta' AND lower(trim(position)) IN ('bendahara','pengawas','kepala sekolah','dinas pendidikan') THEN 'source_participant'
  END AS category FROM people WHERE archived_at IS NULL
), selected_status AS (
  SELECT DISTINCT ON (a.person_id,a.venue_id) a.person_id,a.venue_id,a.status
  FROM attendance a JOIN sessions s ON s.id=a.session_id
  WHERE a.venue_id IS NOT NULL AND ($1::int IS NULL OR a.venue_id=$1)
    AND ($2::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$2)
    AND (CASE WHEN $3::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$3 END)
  ORDER BY a.person_id,a.venue_id,${statusOrder}
), statuses AS (
  SELECT person_id,jsonb_object_agg(venue_id,status) AS status_by_venue FROM selected_status GROUP BY person_id
)
SELECT p.id,p.code,p.name,p.venue_id,p.category,p.institution,p.position,p.npsn,p.room,
  ${includeArrival ? 'arrival.marks->>p.id::text' : 'NULL::text'} AS arrival_status,COALESCE(statuses.status_by_venue,'{}'::jsonb) AS status_by_venue
FROM profiles p ${includeArrival ? 'LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id' : ''}
LEFT JOIN statuses ON statuses.person_id=p.id
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
  if (/^(fasil|verifikator)/.test(position)) return 'fasil';
  if (/^lo($|\s)|^liaison officer$/.test(position)) return 'lo';
  if (p.role === 'peserta') return Object.entries(participantPositions).find(([, value]) => value === position || position === 'kepala sekolah' && value === 'pengawas')?.[0] || 'other';
  return 'other';
};
const loadSessionRecords = (venueId, day, testSession) => q(`WITH fallback_names AS MATERIALIZED (
  SELECT r.venue_id,lower(trim(d->>'position')) AS position,lower(trim(d->>'institution')) AS institution,
    min(d->>'name') AS name
  FROM venue_arrival_recap r CROSS JOIN LATERAL jsonb_array_elements(r.detail_rows) d
  WHERE ($1::int IS NULL OR r.venue_id=$1)
    AND trim(d->>'name') NOT IN ('','-') AND lower(d->>'name') NOT LIKE '%belum ada%'
  GROUP BY r.venue_id,lower(trim(d->>'position')),lower(trim(d->>'institution'))
  HAVING count(DISTINCT lower(trim(d->>'name')))=1
)
SELECT a.id,a.person_id,a.venue_id,a.status,
  CASE WHEN lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah','dinas pendidikan') AND arrival.representatives->p.id::text->>'name' IS NOT NULL
    THEN arrival.representatives->p.id::text->>'name'
  WHEN lower(trim(p.name)) IN ('(belum ada di biodata)','belum ada di biodata','(belum ada)','-','') THEN COALESCE(fallback.name,p.name)
  ELSE p.name END AS name,p.name AS original_name,p.institution,p.npsn,p.ruangan AS room,p.role,p.position
  FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN people p ON p.id=a.person_id
  LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=a.venue_id
  LEFT JOIN fallback_names fallback ON fallback.venue_id=a.venue_id
    AND fallback.position=lower(trim(p.position)) AND fallback.institution=lower(trim(p.institution))
  WHERE ($1::int IS NULL OR a.venue_id=$1) AND a.status IN ('valid','review','ditolak','berhalangan')
    AND ($2::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$2)
    AND (CASE WHEN $3::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$3 END)
  ORDER BY p.name,a.id`, [venueId,day,testSession]);

export async function getVenueAttendanceDetails(venueId, group, day = null, testSession = null) {
  if (group === 'representative' && eventId() === 5) {
    const [{ rows: [roster] }, { rows: [venue] }, { rows: records }] = await Promise.all([
      q("SELECT data->'schools' AS schools FROM assignment_roster WHERE id=1"), q('SELECT name FROM venues WHERE id=$1', [venueId]), loadSessionRecords(venueId, day, testSession),
    ]);
    const schools=(roster?.schools || []).filter(s=>arrivalVenueKey(s.venue)===arrivalVenueKey(venue?.name));
    const entries = schoolRepresentatives(await getSchoolArrivalStatuses(schools,venueId), venue?.name);
    return representativeAttendance(entries,records);
  }
  const [entries, { rows: records }] = await Promise.all([
    group === 'other' ? Promise.resolve([]) : loadVenueAttendanceDetails(venueId, group, day, testSession),
    loadSessionRecords(venueId, day, testSession),
  ]);
  if (eventId() === 5 && ['bendahara', 'pengawas'].includes(group)) {
    const representatives = await getVenueAttendanceDetails(venueId, 'representative', day, testSession);
    const isRepresentative = entry => representatives.some(p => nameKey(p.name) === nameKey(entry.name) &&
      (p.npsn && entry.npsn ? String(entry.npsn).split(';').includes(p.npsn) : nameKey(p.institution) === nameKey(entry.institution)));
    entries.splice(0, entries.length, ...entries.filter(entry => !isRepresentative(entry)));
    const matchRepresentative=representativeMatcher(representatives);
    records.splice(0, records.length, ...records.filter(record => !matchRepresentative(record)));
  }
  const actual = records.filter(p => recordGroup(p) === group).map(p => {
    const linked = entries.filter(e => e.source_profile_id === p.person_id);
    const arrived = linked.filter(e => e.people?.some(person => ['selesai','sudah_tiba','sedang_antre'].includes(person.arrival_status)));
    const candidates = arrived.length ? arrived : linked;
    const names = [...new Set(candidates.map(e => e.name).filter(name => name && name !== '-' && !/belum ada/i.test(name)))];
    return names.length === 1 ? {...p,name:names[0]} : p;
  });
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
  const { rows: schoolAssignments } = ['bendahara','pengawas'].includes(group) ? await q(`
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
      return [entry.name, entry.original_name].filter(Boolean).some(name => nameKey(assignment.name) === nameKey(name))
        && (!schools.length || !assignedSchools.length || sameSchool);
    });
    const institutions = String(entry.institution || '').split(';').filter(Boolean);
    let schoolOwners = schoolAssignments.filter(school => schools.length
      ? schools.includes(school.npsn)
      : institutions.some(institution => schoolIdentity(institution) && schoolIdentity(institution) === schoolIdentity(school.institution)));
    if (!schoolOwners.length) {
      const similar = schoolAssignments.filter(school => institutions.some(institution => similarSchool(institution,school.institution)));
      if (new Set(similar.map(school => school.lo_name)).size === 1) schoolOwners = similar;
    }
    const owners = schoolOwners.length ? schoolOwners : assigned;
    return { ...entry, assigned_los: [...new Set(owners.map(assignment => assignment.lo_name))] };
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
  const [{ rows: venues }, { rows: [roster] }, { rows: profiles }, { rows: sources }, { rows: recordCounts }] = await Promise.all([
    q(`WITH present AS (
      SELECT a.person_id,a.venue_id,bool_or(a.status IN ('valid','review')) AS attended,
        bool_or(a.status IN ('valid','review','berhalangan')) AS recorded
      FROM attendance a JOIN sessions s ON s.id=a.session_id
      WHERE ($1::int IS NULL OR a.venue_id=$1)
        AND ($3::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3)
        AND (CASE WHEN $4::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$4 END)
      GROUP BY a.person_id,a.venue_id
    ), counts AS (
      SELECT p.venue_id,lower(trim(p.position)) AS category,count(*)::int AS total,
        count(*) FILTER (WHERE present.attended)::int AS attended,
        count(*) FILTER (WHERE present.recorded)::int AS recorded
      FROM people p LEFT JOIN present ON present.person_id=p.id AND present.venue_id=p.venue_id
      WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position))=ANY($2::text[])
        AND p.venue_id IS NOT NULL AND ($1::int IS NULL OR p.venue_id=$1)
      GROUP BY p.venue_id,lower(trim(p.position))
    )
    SELECT v.id, v.name, COALESCE(jsonb_object_agg(c.category, jsonb_build_object(
      'total', c.total, 'registered', c.total, 'attended', c.attended, 'recorded', c.recorded)) FILTER (WHERE c.category IS NOT NULL), '{}') AS counts
    FROM venues v LEFT JOIN counts c ON c.venue_id=v.id WHERE ${eventVenueScope('v')}
    GROUP BY v.id, v.name ORDER BY v.name`, [venueId, Object.values(participantPositions), day, testSession]),
    loadRoster(),
    loadProfiles(venueId, day, testSession, false),
    loadArrivalSources(venueId),
    q(`SELECT a.venue_id,p.role,p.position,count(*)::int AS n
      FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN people p ON p.id=a.person_id
      WHERE ($1::int IS NULL OR a.venue_id=$1) AND a.status IN ('valid','review','ditolak','berhalangan')
        AND ($2::date IS NULL OR (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$2)
        AND (CASE WHEN $3::int IS NULL THEN NOT s.is_test ELSE s.is_test AND s.id=$3 END)
      GROUP BY a.venue_id,p.role,p.position`,[venueId,day,testSession]),
  ]);

  const cards = new Map(venues.filter(({ id }) => venueId == null || id === venueId).map(({ id, name, counts }) => [id, {
    id, name, fasil: emptyCount(), lo: emptyCount(),
    ...Object.fromEntries(Object.entries(participantPositions).map(([key, position]) => [key, counts[position] ?? emptyCount()])),
  }]));
  const ids = rosterVenueIds(venues, roster);
  for (const source of sources) {
    const card = cards.get(source.venue_id); if (!card) continue;
    for (const group of ['bendahara','dinas']) {
      const result = sourceAttendance(source,profiles,participantPositions[group]);
      if (result) card[group] = result.count;
    }
    if (eventId() !== 5 && Array.isArray(source.detail_rows)) {
      const heads = new Set();
      for (const row of source.detail_rows) {
        if (row.position !== 'Kepala Sekolah' || !['selesai','sudah_tiba','sedang_antre'].includes(row.arrival_status)) continue;
        heads.add(`${String(row.name || '').trim().toLowerCase()}:${String(row.institution || '').trim().toLowerCase()}`);
      }
      card.pengawas.arrivalTarget = heads.size;
    }
  }
  const representativesByVenue = new Map();
  if (eventId() === 5) {
    const schools = await getSchoolArrivalStatuses(roster?.schools || []);
    for (const card of cards.values()) {
      const assigned = schools.filter(school => arrivalVenueKey(school.venue) === arrivalVenueKey(card.name));
      const representatives = schoolRepresentatives(assigned, card.name);
      representativesByVenue.set(card.id, representatives);
      card.representative = { ...emptyCount(), arrivalTarget: representatives.filter(e =>
        ['selesai','sudah_tiba','sedang_antre'].includes(e.people[0].arrival_status)).length };
      for (const [group, role] of [['bendahara', 'Bendahara'], ['pengawas', 'Kepala Sekolah']]) {
        const seen = new Set();
        for (const school of assigned) {
          if ((school.arrival_attendees || []).some(person => person.role === role &&
            ['selesai','sudah_tiba','sedang_antre'].includes(person.status))) {
            seen.add(school.npsn || nameKey(school.name));
          }
        }
        card[group].arrivalTarget = seen.size;
      }
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
  for (const card of cards.values()) {
    card.other = emptyCount();
    for (const group of [...Object.keys(participantPositions), 'fasil', 'lo']) card[group].recorded = 0;
  }
  for (const record of recordCounts) {
    const card = cards.get(record.venue_id); if (!card) continue;
    const group = recordGroup(record);
    card[group].recorded += record.n;
    if (group === 'other') card.other.total += record.n;
  }
  for (const [id, entries] of representativesByVenue) {
    const { rows: records } = await loadSessionRecords(id, day, testSession);
    const matchRepresentative=representativeMatcher(entries);
    for (const record of records) {
      if (!matchRepresentative(record)) continue;
      const card = cards.get(id);
      const group = recordGroup(record);
      card[group].recorded = Math.max(0, card[group].recorded - 1);
      if (group === 'other') card.other.total = Math.max(0, card.other.total - 1);
      card.representative.recorded++;
    }
  }
  return [...cards.values()];
}
